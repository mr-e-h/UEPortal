import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import { logTenderActivity } from '@/lib/tender'
import { randomUUID } from 'crypto'
import type {
  Tender, TenderLine, TenderBid, TenderBidLine, TenderInvitation, ProjectBudgetLine,
} from '@/types'

/**
 * POST /api/tenders/[id]/award — choose a winning UE.
 *
 * Side-effects (mirrors the change-order approval → budget pattern):
 *  1. tender.status → 'awarded', records winner + who/when.
 *  2. invitations: winner → 'won', everyone else → 'lost'.
 *  3. winning bid → status stays 'submitted'; losing bids untouched.
 *  4. For each CATALOG line (product_id set) the winner priced, write/refresh a
 *     project_budget_line with the agreed unit price snapshot. Free-text lines
 *     are skipped (no product to budget against) and reported back so the PM
 *     knows to add them manually.
 *  5. ensure the winner is linked to the project (project_subcontractors).
 *
 * Idempotent-ish: re-awarding the same tender is blocked unless ?force=1 is
 * passed (kept simple for phase 1 — awarding is a deliberate end step).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => ({})) as { subcontractor_id?: string }
  const winnerId = body.subcontractor_id
  if (!winnerId) {
    return NextResponse.json({ error: 'subcontractor_id mangler' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const { data: tender } = await sb
    .from('tenders')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<Tender>()
  if (!tender) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  const denied = await ensureProjectWritable(auth.user, tender.project_id)
  if (denied) return denied

  if (tender.status === 'awarded') {
    return NextResponse.json({ error: 'Anbudet er allerede tildelt' }, { status: 400 })
  }

  // The winner must have a submitted current bid.
  const { data: winningBid } = await sb
    .from('tender_bids')
    .select('*')
    .eq('tender_id', params.id)
    .eq('subcontractor_id', winnerId)
    .eq('is_current', true)
    .maybeSingle<TenderBid>()
  if (!winningBid || winningBid.status !== 'submitted') {
    return NextResponse.json({ error: 'Valgt UE har ikke sendt inn et tilbud' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // 1. Mark tender awarded.
  await sb.from('tenders').update({
    status: 'awarded',
    awarded_subcontractor_id: winnerId,
    awarded_at: now,
    awarded_by: auth.user.full_name,
    updated_at: now,
  }).eq('id', params.id)

  // 2. Invitation statuses: winner won, others lost.
  const { data: invites } = await sb
    .from('tender_invitations')
    .select('*')
    .eq('tender_id', params.id)
  for (const inv of ((invites ?? []) as TenderInvitation[])) {
    await sb.from('tender_invitations')
      .update({ status: inv.subcontractor_id === winnerId ? 'won' : 'lost' })
      .eq('id', inv.id)
  }

  // 4. Post catalog lines into the project budget.
  const [{ data: linesData }, { data: bidLinesData }] = await Promise.all([
    sb.from('tender_lines').select('*').eq('tender_id', params.id),
    sb.from('tender_bid_lines').select('*').eq('tender_bid_id', winningBid.id),
  ])
  const lines = (linesData ?? []) as TenderLine[]
  const bidLines = (bidLinesData ?? []) as TenderBidLine[]
  const priceByLine = new Map(bidLines.map((bl) => [bl.tender_line_id, bl.unit_price]))

  let postedCount = 0
  const skippedFreeText: string[] = []
  for (const line of lines) {
    const unitPrice = priceByLine.get(line.id) ?? 0
    if (!line.product_id) {
      // Free-text line — no product to attach to the budget. Report it back.
      skippedFreeText.push(line.description || '(uten navn)')
      continue
    }
    if (line.quantity <= 0) continue

    // customer_price_snapshot comes from the product master (MinUE's sell
    // price), exactly like manual budget lines. The winning UE's unit price
    // becomes the cost snapshot.
    const { data: product } = await sb
      .from('products')
      .select('customer_price')
      .eq('id', line.product_id)
      .maybeSingle<{ customer_price: number }>()

    const { data: existing } = await sb
      .from('project_budget_lines')
      .select('*')
      .eq('project_id', tender.project_id)
      .eq('product_id', line.product_id)
      .eq('assigned_subcontractor_id', winnerId)
      .maybeSingle<ProjectBudgetLine>()

    if (existing) {
      await sb.from('project_budget_lines').update({
        budget_quantity: existing.budget_quantity + line.quantity,
        subcontractor_cost_price_snapshot: unitPrice,
      }).eq('id', existing.id)
    } else {
      const newLine: ProjectBudgetLine = {
        id: randomUUID(),
        project_id: tender.project_id,
        product_id: line.product_id,
        budget_quantity: line.quantity,
        customer_price_snapshot: product?.customer_price ?? 0,
        assigned_subcontractor_id: winnerId,
        subcontractor_cost_price_snapshot: unitPrice,
        source: 'manual',
        line_type: 'subcontractor_work',
      }
      await sb.from('project_budget_lines').insert(newLine)
    }
    postedCount++
  }

  // 5. Ensure the winner is on the project.
  const { data: linkExists } = await sb
    .from('project_subcontractors')
    .select('id')
    .eq('project_id', tender.project_id)
    .eq('subcontractor_id', winnerId)
    .maybeSingle()
  if (!linkExists) {
    await sb.from('project_subcontractors').insert({
      id: randomUUID(),
      project_id: tender.project_id,
      subcontractor_id: winnerId,
    })
  }

  await logTenderActivity(
    params.id,
    'awarded',
    auth.user.full_name,
    `Tildelt UE ${winnerId} · ${postedCount} budsjettlinjer opprettet`,
  )

  return NextResponse.json({
    ok: true,
    posted_budget_lines: postedCount,
    skipped_free_text: skippedFreeText,
  })
}
