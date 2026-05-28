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
      status?: 'pending' | 'draft'
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
      // Subs can only touch their own drafts.
      if (order.status !== 'draft') {
        return NextResponse.json({ error: 'Kan kun redigere kladder' }, { status: 409 })
      }
    } else if (isAdmin(session)) {
      // Admins can edit drafts AND pending EMs (audit-trailed). Once an EM
      // is approved or rejected they must hit 'Angre' first so review state
      // is reset alongside.
      if (order.status !== 'draft' && order.status !== 'pending') {
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

    const newProductId = body.product_id ?? order.product_id
    const newQuantity = body.requested_quantity !== undefined
      ? Number(body.requested_quantity)
      : order.requested_quantity
    if (!Number.isFinite(newQuantity) || newQuantity <= 0) {
      return NextResponse.json({ error: 'Mengde må være et positivt tall' }, { status: 400 })
    }
    const newReason = body.reason ?? order.reason
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

    // Audit-trail admin edits to non-draft EMs — sub-editing their own draft
    // pre-submission is routine and would just be noise in the activity log.
    if (isAdmin(session) && order.status === 'pending') {
      const diffs: string[] = []
      if (order.requested_quantity !== newQuantity) diffs.push(`mengde: ${order.requested_quantity} → ${newQuantity}`)
      if (order.product_id !== newProductId) diffs.push('produkt endret')
      if ((order.reason ?? '') !== (newReason ?? '')) diffs.push('begrunnelse endret')
      if (diffs.length > 0) {
        const { randomUUID } = await import('crypto')
        await sb.from('activity_log').insert({
          id: randomUUID(),
          entity_type: 'change_order',
          entity_id: params.id,
          action: 'edited',
          actor: session.full_name,
          comment: diffs.join(' · '),
          created_at: now,
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
