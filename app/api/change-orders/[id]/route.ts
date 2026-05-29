import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub, ensureProjectWritable } from '@/lib/api-guard'
import type { ChangeOrder, ChangeOrderLine, ChangeOrderConsequenceLine, Product, SubcontractorProductPrice, ProjectBudgetLine } from '@/types'

/**
 * Komplett snapshot av en EM på et gitt tidspunkt — brukes som verdi i
 * activity_log.metadata.before og .after for 'edited'-rader. Strukturen
 * speiler tabellrelasjonene: hoved + linjer + konsekvens-linjer som
 * separate arrays slik at VersionDiffModal kan render per-linje-diff
 * uten å rekonstruere fra rollup-totaler.
 */
type ChangeOrderSnapshot = {
  change_order: Partial<ChangeOrder>
  lines: Array<Omit<ChangeOrderLine, 'id' | 'change_order_id' | 'created_at'>>
  consequence_lines: Array<Omit<ChangeOrderConsequenceLine, 'id' | 'change_order_id' | 'created_at'>>
}

/**
 * Hent komplett snapshot fra DB. Kjøres én gang før mutasjon (before) og
 * én gang etter at alle mutasjoner inkludert consequence_lines-replace er
 * ferdig (after). Vi tar med hovedfelt-cachen på change_orders i tillegg
 * til den autoritative lines-arrayen — admin-konsumenter trenger
 * rollup-totaler, og UE-strip-laget i /api/activity tar bort
 * customer_*-feltene fra metadata før det går til UE.
 */
async function captureChangeOrderSnapshot(
  sb: ReturnType<typeof getSupabaseAdmin>,
  changeOrderId: string,
  orderRow: ChangeOrder,
): Promise<ChangeOrderSnapshot> {
  const [linesRes, conseqRes] = await Promise.all([
    sb.from('change_order_lines')
      .select('product_id, requested_quantity, unit, cost_price_snapshot, customer_price_snapshot, sort_order')
      .eq('change_order_id', changeOrderId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    sb.from('change_order_consequence_lines')
      .select('product_id, quantity, unit, cost_price_snapshot, customer_price_snapshot, sort_order')
      .eq('change_order_id', changeOrderId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])
  return {
    change_order: {
      em_type: orderRow.em_type,
      status: orderRow.status,
      product_id: orderRow.product_id,
      requested_quantity: orderRow.requested_quantity,
      unit: orderRow.unit,
      reason: orderRow.reason,
      solution: orderRow.solution,
      cost_price_snapshot: orderRow.cost_price_snapshot,
      customer_price_snapshot: orderRow.customer_price_snapshot,
      total_cost: orderRow.total_cost,
      total_customer_value: orderRow.total_customer_value,
      profit: orderRow.profit,
      attachment_url: orderRow.attachment_url,
    },
    lines: (linesRes.data ?? []) as ChangeOrderSnapshot['lines'],
    consequence_lines: (conseqRes.data ?? []) as ChangeOrderSnapshot['consequence_lines'],
  }
}

/**
 * Bygg en kort lesbar oppsummeringstekst basert på diff mellom to
 * snapshots — vises i activity-feeden uten å åpne VersionDiffModal.
 * Returnerer null hvis ingenting er endret (caller bruker det som
 * "ingen audit-rad nødvendig").
 */
function buildEditedSummary(before: ChangeOrderSnapshot, after: ChangeOrderSnapshot): string | null {
  const parts: string[] = []
  const bco = before.change_order
  const aco = after.change_order
  if (bco.reason !== aco.reason) parts.push('beskrivelse endret')
  if (bco.solution !== aco.solution) parts.push('løsning endret')
  if (bco.em_type !== aco.em_type) parts.push('type endret')
  // Per-linje diff: telling av lagt-til/fjernet/endret holder for summary.
  const beforeLineKeys = new Set(before.lines.map((l) => `${l.product_id}|${l.requested_quantity}`))
  const afterLineKeys = new Set(after.lines.map((l) => `${l.product_id}|${l.requested_quantity}`))
  const addedLines = after.lines.filter((l) => !beforeLineKeys.has(`${l.product_id}|${l.requested_quantity}`))
  const removedLines = before.lines.filter((l) => !afterLineKeys.has(`${l.product_id}|${l.requested_quantity}`))
  if (before.lines.length !== after.lines.length) {
    parts.push(`linjer: ${before.lines.length} → ${after.lines.length}`)
  } else if (addedLines.length > 0 || removedLines.length > 0) {
    parts.push('linjer endret')
  }
  if (before.consequence_lines.length !== after.consequence_lines.length) {
    parts.push(`konsekvens: ${before.consequence_lines.length} → ${after.consequence_lines.length}`)
  } else if (JSON.stringify(before.consequence_lines) !== JSON.stringify(after.consequence_lines)) {
    parts.push('konsekvens endret')
  }
  if (parts.length === 0) {
    // Total-tall kan ha skiftet på grunn av re-priser (sjeldent) — sjekk
    // som siste skanse så vi ikke logger no-op edits.
    if (bco.total_cost !== aco.total_cost || bco.total_customer_value !== aco.total_customer_value) {
      parts.push('priser justert')
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Replace-all av "konsekvens ved avslag"-linjer for en EM. Tar mot enkle
 * { product_id, quantity }-objekter; serveren slår opp gjeldende
 * cost-pris (fra UE-prisliste, fallback til budsjettlinjen) og kunde-pris
 * (fra produktmasteren) per linje, så vi har snapshots å reversere mot
 * når EMen avvises eller angres senere.
 *
 * Returnerer string med feilmelding ved problem, ellers null.
 */
async function replaceConsequenceLines(
  sb: ReturnType<typeof getSupabaseAdmin>,
  order: ChangeOrder,
  rawLines: Array<{ product_id: string; quantity: number }>,
): Promise<string | null> {
  // Valider input før vi sletter eksisterende — så enten lykkes alt eller
  // ingenting endres.
  type Snap = { product_id: string; qty: number; unit: string; cost: number; customer: number }
  const snaps: Snap[] = []
  for (const ln of rawLines) {
    const qty = Number(ln.quantity)
    if (!Number.isFinite(qty) || qty <= 0) return 'Konsekvens-mengde må være et positivt tall'
    const [productRes, priceRes, blRes] = await Promise.all([
      sb.from('products').select('customer_price, unit').eq('id', ln.product_id).maybeSingle<Pick<Product, 'customer_price' | 'unit'>>(),
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
    if (!productRes.data) return 'Produkt på konsekvens-linje ikke funnet'
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
    })
  }

  const { error: delErr } = await sb
    .from('change_order_consequence_lines')
    .delete()
    .eq('change_order_id', order.id)
  if (delErr) return `Konsekvens-linjer (slett): ${delErr.message}`

  if (snaps.length > 0) {
    const payload = snaps.map((s, i) => ({
      id: randomUUID(),
      change_order_id: order.id,
      product_id: s.product_id,
      quantity: s.qty,
      unit: s.unit,
      cost_price_snapshot: s.cost,
      customer_price_snapshot: s.customer,
      sort_order: i,
    }))
    const { error: insErr } = await sb.from('change_order_consequence_lines').insert(payload)
    if (insErr) return `Konsekvens-linjer (lagre): ${insErr.message}`
  }
  return null
}

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
      /** "Konsekvens ved å avslå" — replace-all når feltet er satt. PL/admin
       *  only. Body sender produktet + mengde; serveren slår opp gjeldende
       *  cost/customer-price-snapshots fra UE-prislisten + produktmasteren
       *  så avslag-logikken senere kan reversere riktig sum. */
      consequence_lines?: Array<{ product_id: string; quantity: number }>
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

    // For admin/PM-edits: fang komplett før-snapshot AV ALT (hovedfelt +
    // alle linjer + alle konsekvens-linjer) før første mutasjon. Brukes
    // som metadata.before når vi skriver én samlet 'edited'-rad helt på
    // slutten av PUT. UE-edits logges ikke som 'edited' — de fanges av
    // 'submitted' (draft→pending) og 'resubmitted' (revision_requested
    // →pending) i steden.
    const willAuditEdit = isAdmin(session)
    const beforeSnapshot: ChangeOrderSnapshot | null = willAuditEdit
      ? await captureChangeOrderSnapshot(sb, params.id, order)
      : null

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

      // Konsekvens-linjer er admin/PM-only. UE har allerede returnert i en
      // tidligere gate, men sjekker eksplisitt for å være på den sikre siden.
      // Kjøres FØR audit-loggen så etter-snapshot fanger
      // konsekvens-endringer i samme rad.
      if (Array.isArray(body.consequence_lines) && isAdmin(session) && updatedOrder) {
        const err = await replaceConsequenceLines(sb, updatedOrder, body.consequence_lines)
        if (err) return NextResponse.json({ error: err }, { status: 400 })
      }

      // Samlet 'edited'-audit (multi-line path). Fang etter-snapshot fra
      // DB — inkludert lines + consequence_lines — og sammenlign med før.
      // Skriver kun én rad per request, kun hvis noe faktisk er endret.
      if (willAuditEdit && beforeSnapshot && updatedOrder) {
        const afterSnapshot = await captureChangeOrderSnapshot(sb, params.id, updatedOrder)
        const summary = buildEditedSummary(beforeSnapshot, afterSnapshot)
        if (summary) {
          await sb.from('activity_log').insert({
            id: makeId(),
            entity_type: 'change_order',
            entity_id: params.id,
            action: 'edited',
            actor: session.full_name,
            comment: summary,
            created_at: now2,
            metadata: { before: beforeSnapshot, after: afterSnapshot },
          })
        }
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

    // change_order_lines speilesynk for single-line path: oppdater den
    // ene eksisterende linjen så lines-tabellen forblir sannheten om
    // produkt+mengde+snapshots. Hvis EMen hadde flere linjer fra før
    // (sjelden — admin-edit bruker multi-line path), beholdes de
    // ekstra linjene urørt. NB: single-line PUT er primært UE-flyten.
    if (newProductId !== order.product_id || newQuantity !== order.requested_quantity) {
      await sb.from('change_order_lines')
        .update({
          product_id: newProductId,
          requested_quantity: newQuantity,
          unit,
          cost_price_snapshot: costPriceSnapshot,
          customer_price_snapshot: customerPriceSnapshot,
        })
        .eq('change_order_id', params.id)
        .eq('sort_order', 0)
    }

    // UE som sender inn ny versjon etter revisjon — logg som 'resubmitted'.
    // Egen handlingstype så Versjonsloggen kan vise "Sendte inn ny versjon"
    // tydelig adskilt fra første innsending eller en vanlig redigering.
    // Kjøres FØR consequence_lines siden den ikke endrer disse uansett.
    if (isSub(session) && order.status === 'revision_requested' && newStatus === 'pending') {
      await sb.from('activity_log').insert({
        id: randomUUID(),
        entity_type: 'change_order',
        entity_id: params.id,
        action: 'resubmitted',
        actor: session.full_name,
        created_at: now,
      })
    }

    // Konsekvens-linjer FØR audit-log slik at etter-snapshot fanger dem.
    if (Array.isArray(body.consequence_lines) && isAdmin(session)) {
      const err = await replaceConsequenceLines(sb, data, body.consequence_lines)
      if (err) return NextResponse.json({ error: err }, { status: 400 })
    }

    // Samlet 'edited'-audit (single-line path). Identisk struktur som
    // multi-line path. Skriver kun én rad, og kun hvis snapshots
    // faktisk er forskjellige. Admin-edits på drafts logges også nå —
    // den gamle koden filtrerte dem ut som "støy", men brukeren ønsker
    // full sporbarhet av admin-endringer uansett status.
    if (willAuditEdit && beforeSnapshot) {
      const afterSnapshot = await captureChangeOrderSnapshot(sb, params.id, data)
      const summary = buildEditedSummary(beforeSnapshot, afterSnapshot)
      if (summary) {
        await sb.from('activity_log').insert({
          id: randomUUID(),
          entity_type: 'change_order',
          entity_id: params.id,
          action: 'edited',
          actor: session.full_name,
          comment: summary,
          created_at: now,
          metadata: { before: beforeSnapshot, after: afterSnapshot },
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
