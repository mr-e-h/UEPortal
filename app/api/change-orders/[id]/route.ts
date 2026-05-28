import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub, ensureProjectWritable } from '@/lib/api-guard'
import type { ChangeOrder, Product, SubcontractorProductPrice, ProjectBudgetLine } from '@/types'

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

    const body = await request.json() as {
      product_id?: string
      requested_quantity?: number
      reason?: string
      solution?: string
      em_type?: 'economic' | 'spec_deviation' | 'time'
      status?: 'pending' | 'draft'
      lines?: Array<{ product_id: string; requested_quantity: number }>
    }

    if (body.em_type !== undefined && !['economic', 'spec_deviation', 'time'].includes(body.em_type)) {
      return NextResponse.json({ error: 'Ugyldig type' }, { status: 400 })
    }

    const sb = getSupabaseAdmin()
    const { data: order, error: readErr } = await sb
      .from('change_orders')
      .select('*')
      .eq('id', params.id)
      .maybeSingle<ChangeOrder>()
    if (readErr) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (isSub(session)) {
      if (order.subcontractor_id !== session.subcontractor_id) {
        return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
      }
      // Subs can edit their own drafts AND any EM admin returned for revision
      // (revision_requested). The latter case is the "Be om ny versjon"-flyten:
      // admin sender tilbake, UE retter opp og sender på nytt → pending.
      if (order.status !== 'draft' && order.status !== 'revision_requested') {
        return NextResponse.json({ error: 'Kan kun redigere kladder eller EM som er sendt tilbake til revisjon' }, { status: 409 })
      }
    } else if (isAdmin(session)) {
      // Admins can edit drafts AND pending EMs (audit-trailed). Once an EM
      // is approved or rejected they must hit 'Angre' first so review state
      // is reset alongside.
      if (order.status !== 'draft' && order.status !== 'pending' && order.status !== 'revision_requested') {
        return NextResponse.json({ error: 'Behandlede endringsmeldinger må angres før de kan redigeres' }, { status: 409 })
      }
    } else {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }

    // PM write-side gate (admin path only — UE was already filtered above).
    if (isAdmin(session)) {
      const denied = await ensureProjectWritable(session, order.project_id)
      if (denied) return denied
    }

    // ── Multi-line path (admin edit form sends `lines: [...]`) ────────────
    // When the client sends a lines array, we treat it as the authoritative
    // composition of the EM: delete existing lines, insert these, and
    // recompute the change_orders rollup totals. Single-product compat is
    // preserved by syncing the first line's product/qty/unit/snapshots back
    // onto change_orders (so list views and project rollups still work).
    if (Array.isArray(body.lines)) {
      const newReason = body.reason ?? order.reason
      const newSolution = body.solution ?? order.solution ?? ''
      const newEmType = body.em_type ?? order.em_type
      const linesIn = body.lines
      if (linesIn.length === 0) {
        return NextResponse.json({ error: 'En endringsmelding må ha minst én linje' }, { status: 400 })
      }

      // Resolve snapshots for every line in parallel: product (for customer
      // price + unit), and per-sub price → fall back to project_budget_lines'
      // already-locked sub cost if the per-sub list doesn't carry it.
      type Snap = { product_id: string; qty: number; unit: string; cost: number; customer: number; productName?: string }
      const snaps: Snap[] = []
      for (const ln of linesIn) {
        const qty = Number(ln.requested_quantity)
        if (!Number.isFinite(qty) || qty <= 0) {
          return NextResponse.json({ error: 'Mengde må være et positivt tall på hver linje' }, { status: 400 })
        }
        const [productRes, priceRes, blRes] = await Promise.all([
          sb.from('products').select('name, customer_price, unit').eq('id', ln.product_id).maybeSingle<{ name: string; customer_price: number; unit: string }>(),
          sb.from('subcontractor_product_prices').select('cost_price')
            .eq('subcontractor_id', order.subcontractor_id)
            .eq('product_id', ln.product_id)
            .maybeSingle<Pick<SubcontractorProductPrice, 'cost_price'>>(),
          sb.from('project_budget_lines').select('subcontractor_cost_price_snapshot')
            .eq('project_id', order.project_id)
            .eq('product_id', ln.product_id)
            .eq('assigned_subcontractor_id', order.subcontractor_id)
            .maybeSingle<Pick<ProjectBudgetLine, 'subcontractor_cost_price_snapshot'>>(),
        ])
        if (!productRes.data) return NextResponse.json({ error: 'Produkt ikke funnet' }, { status: 404 })
        let cost = priceRes.data?.cost_price ?? 0
        if (cost === 0 && blRes.data && blRes.data.subcontractor_cost_price_snapshot > 0) {
          cost = blRes.data.subcontractor_cost_price_snapshot
        }
        snaps.push({
          product_id: ln.product_id,
          qty,
          unit: productRes.data.unit,
          cost,
          customer: productRes.data.customer_price,
          productName: productRes.data.name,
        })
      }

      // Replace lines: delete current, insert new in order.
      const { randomUUID: makeId } = await import('crypto')
      const { error: delErr } = await sb.from('change_order_lines').delete().eq('change_order_id', params.id)
      if (delErr) return NextResponse.json({ error: 'Lagring feilet (lines/del)' }, { status: 500 })
      const newLinesPayload = snaps.map((s, i) => ({
        id: makeId(),
        change_order_id: params.id,
        product_id: s.product_id,
        requested_quantity: s.qty,
        unit: s.unit,
        cost_price_snapshot: s.cost,
        customer_price_snapshot: s.customer,
        sort_order: i,
      }))
      const { error: insErr } = await sb.from('change_order_lines').insert(newLinesPayload)
      if (insErr) return NextResponse.json({ error: 'Lagring feilet (lines/ins)' }, { status: 500 })

      // Rollup totals + sync first-line fields back to change_orders so the
      // existing single-product list views keep working.
      const totalCost = snaps.reduce((s, l) => s + l.cost * l.qty, 0)
      const totalCustomer = snaps.reduce((s, l) => s + l.customer * l.qty, 0)
      const firstLine = snaps[0]
      const now2 = new Date().toISOString()
      const { data: updatedOrder, error: updErr } = await sb
        .from('change_orders')
        .update({
          product_id: firstLine.product_id,
          requested_quantity: firstLine.qty,
          unit: firstLine.unit,
          cost_price_snapshot: firstLine.cost,
          customer_price_snapshot: firstLine.customer,
          total_cost: totalCost,
          total_customer_value: totalCustomer,
          profit: totalCustomer - totalCost,
          reason: newReason,
          solution: newSolution,
          em_type: newEmType,
        })
        .eq('id', params.id)
        .select()
        .maybeSingle<ChangeOrder>()
      if (updErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

      // Audit log — capture full before/after rollup so the version diff
      // popup can render it. Per-line diffs are intentionally summarized
      // (counts) rather than dumped — keeps the popup compact.
      if (isAdmin(session) && order.status === 'pending') {
        const before = {
          requested_quantity: order.requested_quantity,
          unit: order.unit,
          reason: order.reason,
          solution: order.solution ?? '',
          product_id: order.product_id,
          total_cost: order.total_cost,
          total_customer_value: order.total_customer_value,
          profit: order.profit,
        }
        const after = {
          requested_quantity: firstLine.qty,
          unit: firstLine.unit,
          reason: newReason,
          solution: newSolution,
          product_id: firstLine.product_id,
          total_cost: totalCost,
          total_customer_value: totalCustomer,
          profit: totalCustomer - totalCost,
        }
        const summary = `${snaps.length} ${snaps.length === 1 ? 'linje' : 'linjer'} · totalkost ${order.total_cost} → ${totalCost}`
        await sb.from('activity_log').insert({
          id: makeId(),
          entity_type: 'change_order',
          entity_id: params.id,
          action: 'edited',
          actor: session.full_name,
          comment: summary,
          created_at: now2,
          metadata: { before, after },
        })
      }

      if (isSub(session) && updatedOrder) {
        const { customer_price_snapshot: _cp, total_customer_value: _tcv, profit: _p, ...rest } = updatedOrder
        return NextResponse.json(rest)
      }
      return NextResponse.json(updatedOrder)
    }

    const newProductId = body.product_id ?? order.product_id
    const newQuantity = body.requested_quantity !== undefined
      ? Number(body.requested_quantity)
      : order.requested_quantity
    if (!Number.isFinite(newQuantity) || newQuantity <= 0) {
      return NextResponse.json({ error: 'Mengde må være et positivt tall' }, { status: 400 })
    }
    const newReason = body.reason ?? order.reason
    const newSolution = body.solution ?? order.solution ?? ''
    const newEmType = body.em_type ?? order.em_type
    const newStatus = body.status ?? order.status

    let costPriceSnapshot = order.cost_price_snapshot
    let customerPriceSnapshot = order.customer_price_snapshot
    let unit = order.unit

    // Re-price only when product changed (or quantity changed and we need to
    // confirm price still exists). Three targeted lookups parallel.
    if (newProductId !== order.product_id) {
      const [productRes, priceRes, blRes] = await Promise.all([
        sb.from('products').select('customer_price, unit').eq('id', newProductId).maybeSingle<Pick<Product, 'customer_price' | 'unit'>>(),
        sb.from('subcontractor_product_prices').select('cost_price')
          .eq('subcontractor_id', order.subcontractor_id)
          .eq('product_id', newProductId)
          .maybeSingle<Pick<SubcontractorProductPrice, 'cost_price'>>(),
        sb.from('project_budget_lines').select('subcontractor_cost_price_snapshot')
          .eq('project_id', order.project_id)
          .eq('product_id', newProductId)
          .eq('assigned_subcontractor_id', order.subcontractor_id)
          .maybeSingle<Pick<ProjectBudgetLine, 'subcontractor_cost_price_snapshot'>>(),
      ])

      if (!productRes.data) return NextResponse.json({ error: 'Produkt ikke funnet' }, { status: 404 })

      costPriceSnapshot = priceRes.data?.cost_price ?? 0
      if (costPriceSnapshot === 0 && blRes.data && blRes.data.subcontractor_cost_price_snapshot > 0) {
        costPriceSnapshot = blRes.data.subcontractor_cost_price_snapshot
      }
      customerPriceSnapshot = productRes.data.customer_price
      unit = productRes.data.unit
    }

    const now = new Date().toISOString()
    const updates: Partial<ChangeOrder> = {
      product_id: newProductId,
      requested_quantity: newQuantity,
      unit,
      reason: newReason,
      solution: newSolution,
      em_type: newEmType,
      cost_price_snapshot: costPriceSnapshot,
      customer_price_snapshot: customerPriceSnapshot,
      total_cost: costPriceSnapshot * newQuantity,
      total_customer_value: customerPriceSnapshot * newQuantity,
      profit: (customerPriceSnapshot - costPriceSnapshot) * newQuantity,
      status: newStatus,
      submitted_at: newStatus === 'pending' ? now : order.submitted_at,
    }

    const { data, error } = await sb
      .from('change_orders')
      .update(updates)
      .eq('id', params.id)
      .select()
      .maybeSingle<ChangeOrder>()
    if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // UE som sender inn ny versjon etter revisjon — logg som 'resubmitted'.
    // Egen handlingstype så Versjonsloggen kan vise "Sendte inn ny versjon"
    // tydelig adskilt fra første innsending eller en vanlig redigering.
    if (isSub(session) && order.status === 'revision_requested' && newStatus === 'pending') {
      const { randomUUID } = await import('crypto')
      await sb.from('activity_log').insert({
        id: randomUUID(),
        entity_type: 'change_order',
        entity_id: params.id,
        action: 'resubmitted',
        actor: session.full_name,
        created_at: now,
      })
    }

    // Audit-trail admin edits to non-draft EMs — sub-editing their own draft
    // pre-submission is routine and would just be noise in the activity log.
    // metadata captures the FULL before/after so the Versjonslogg popup can
    // render a side-by-side diff without needing to reconstruct from text.
    if (isAdmin(session) && order.status === 'pending') {
      const diffs: string[] = []
      if (order.requested_quantity !== newQuantity) diffs.push(`mengde: ${order.requested_quantity} → ${newQuantity}`)
      if (order.product_id !== newProductId) diffs.push('produkt endret')
      if ((order.reason ?? '') !== (newReason ?? '')) diffs.push('beskrivelse endret')
      if ((order.solution ?? '') !== (newSolution ?? '')) diffs.push('løsning endret')
      if (diffs.length > 0) {
        const { randomUUID } = await import('crypto')
        const before = {
          requested_quantity: order.requested_quantity,
          unit: order.unit,
          reason: order.reason,
          solution: order.solution ?? '',
          product_id: order.product_id,
          total_cost: order.total_cost,
          total_customer_value: order.total_customer_value,
          profit: order.profit,
          cost_price_snapshot: order.cost_price_snapshot,
          customer_price_snapshot: order.customer_price_snapshot,
        }
        const after = {
          requested_quantity: newQuantity,
          unit,
          reason: newReason,
          solution: newSolution,
          product_id: newProductId,
          total_cost: costPriceSnapshot * newQuantity,
          total_customer_value: customerPriceSnapshot * newQuantity,
          profit: (customerPriceSnapshot - costPriceSnapshot) * newQuantity,
          cost_price_snapshot: costPriceSnapshot,
          customer_price_snapshot: customerPriceSnapshot,
        }
        await sb.from('activity_log').insert({
          id: randomUUID(),
          entity_type: 'change_order',
          entity_id: params.id,
          action: 'edited',
          actor: session.full_name,
          comment: diffs.join(' · '),
          created_at: now,
          metadata: { before, after },
        })
      }
    }

    if (isSub(session)) {
      const { customer_price_snapshot: _cp, total_customer_value: _tcv, profit: _p, ...rest } = data
      return NextResponse.json(rest)
    }
    return NextResponse.json(data)
  } catch (error) {
    console.error('change-orders PUT error:', error)
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 })
  }
}
