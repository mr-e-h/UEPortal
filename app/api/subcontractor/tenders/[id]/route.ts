import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { isTenderExpired, logTenderActivity, resolveEffectiveSub } from '@/lib/tender'
import { randomUUID } from 'crypto'
import type { Tender, TenderLine, TenderInvitation, TenderBid, TenderBidLine } from '@/types'

/**
 * Confirm the current UE is invited to this tender. Returns the invitation row
 * or null. Centralised so GET and PUT share the exact same ownership gate.
 */
async function getOwnInvitation(
  sb: ReturnType<typeof getSupabaseAdmin>,
  tenderId: string,
  subId: string,
): Promise<TenderInvitation | null> {
  const { data } = await sb
    .from('tender_invitations')
    .select('*')
    .eq('tender_id', tenderId)
    .eq('subcontractor_id', subId)
    .maybeSingle<TenderInvitation>()
  return data ?? null
}

/**
 * GET /api/subcontractor/tenders/[id] — the UE's pricing view of one tender.
 * Returns the tender header, the lines to price, and THIS UE's own bid (+ bid
 * lines) only. Absolutely no competitor data. Marks the invitation 'opened' on
 * first view so the PM can see who has looked at it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  const subId = eff.subId

  const sb = getSupabaseAdmin()
  const invitation = await getOwnInvitation(sb, params.id, subId)
  if (!invitation) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  const { data: tender } = await sb
    .from('tenders')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<Tender>()
  if (!tender || tender.status === 'draft') {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  }

  const { data: lineData } = await sb
    .from('tender_lines')
    .select('*')
    .eq('tender_id', params.id)
    .order('sort_order')
  const lines = (lineData ?? []) as TenderLine[]

  // This UE's current bid + its lines (never anyone else's).
  const { data: bid } = await sb
    .from('tender_bids')
    .select('*')
    .eq('tender_id', params.id)
    .eq('subcontractor_id', subId)
    .eq('is_current', true)
    .maybeSingle<TenderBid>()

  let bidLines: TenderBidLine[] = []
  if (bid) {
    const { data: bl } = await sb
      .from('tender_bid_lines')
      .select('*')
      .eq('tender_bid_id', bid.id)
    bidLines = (bl ?? []) as TenderBidLine[]
  }

  // Mark opened on first view (don't downgrade a more-advanced status).
  if (invitation.status === 'invited') {
    await sb.from('tender_invitations')
      .update({ status: 'opened', opened_at: new Date().toISOString() })
      .eq('id', invitation.id)
  }

  return NextResponse.json({
    tender: {
      id: tender.id,
      title: tender.title,
      description: tender.description,
      status: tender.status,
      deadline_at: tender.deadline_at,
      expired: isTenderExpired(tender.deadline_at),
    },
    lines,
    bid: bid ?? null,
    bidLines,
  })
}

type PutBody = {
  /** Map of tender_line_id -> unit price. */
  prices: Record<string, number>
  comment?: string
  /** true = submit (lock-in), false/undefined = save draft. */
  submit?: boolean
}

/**
 * PUT /api/subcontractor/tenders/[id] — save or submit the UE's bid.
 * Refuses once the deadline has passed or the tender is no longer open for
 * pricing. Recomputes the total from the line prices × quantities server-side
 * so the client can't spoof a total.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  const subId = eff.subId

  const sb = getSupabaseAdmin()
  const invitation = await getOwnInvitation(sb, params.id, subId)
  if (!invitation) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  const { data: tender } = await sb
    .from('tenders')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<Tender>()
  if (!tender || tender.status === 'draft') {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  }

  // Deadline / status gate — UE can only price while the tender is live.
  if (isTenderExpired(tender.deadline_at)) {
    return NextResponse.json({ error: 'Svarfristen har gått ut' }, { status: 403 })
  }
  if (!['sent', 'open'].includes(tender.status)) {
    return NextResponse.json({ error: 'Anbudet er ikke åpent for prising' }, { status: 403 })
  }

  const body = await request.json() as PutBody
  const prices = body.prices ?? {}

  // Server-authoritative line set + total.
  const { data: lineData } = await sb
    .from('tender_lines')
    .select('id, quantity')
    .eq('tender_id', params.id)
  const lines = (lineData ?? []) as Array<Pick<TenderLine, 'id' | 'quantity'>>

  let total = 0
  const bidLineRows: Array<{ tender_line_id: string; unit_price: number }> = []
  for (const line of lines) {
    const raw = Number(prices[line.id])
    const unitPrice = Number.isFinite(raw) && raw >= 0 ? raw : 0
    total += unitPrice * line.quantity
    bidLineRows.push({ tender_line_id: line.id, unit_price: unitPrice })
  }

  // T.1: refuse a binding submission with no prices — a 0-total bid could be
  // mistaken for the cheapest offer and awarded by mistake. Saving a 0-draft
  // is still allowed (only submit is blocked).
  if (body.submit && total === 0) {
    return NextResponse.json(
      { error: 'Du må fylle inn minst én pris før du kan sende inn tilbudet' },
      { status: 400 },
    )
  }

  const now = new Date().toISOString()

  // Upsert the UE's current bid (one current bid per UE per tender in phase 1).
  let bid: TenderBid | null = null
  const { data: existing } = await sb
    .from('tender_bids')
    .select('*')
    .eq('tender_id', params.id)
    .eq('subcontractor_id', subId)
    .eq('is_current', true)
    .maybeSingle<TenderBid>()

  const wasSubmitted = existing?.status === 'submitted'
  const nextStatus = body.submit ? 'submitted' : (existing?.status ?? 'draft')

  if (existing) {
    const { data: upd } = await sb.from('tender_bids').update({
      status: nextStatus,
      total_cost: total,
      comment: body.comment ?? existing.comment,
      submitted_at: body.submit ? now : existing.submitted_at,
      submitted_by: body.submit ? eff.user.full_name : existing.submitted_by,
      updated_at: now,
    }).eq('id', existing.id).select().maybeSingle<TenderBid>()
    bid = upd ?? null
    // Replace bid lines wholesale (simplest correct approach for phase 1).
    await sb.from('tender_bid_lines').delete().eq('tender_bid_id', existing.id)
  } else {
    const newBid: TenderBid = {
      id: randomUUID(),
      tender_id: params.id,
      subcontractor_id: subId,
      round: tender.current_round,
      status: nextStatus,
      total_cost: total,
      comment: body.comment ?? '',
      is_current: true,
      submitted_at: body.submit ? now : null,
      submitted_by: body.submit ? eff.user.full_name : null,
      created_at: now,
      updated_at: now,
    }
    const { data: ins } = await sb.from('tender_bids').insert(newBid).select().maybeSingle<TenderBid>()
    bid = ins ?? newBid
  }

  if (bid && bidLineRows.length > 0) {
    await sb.from('tender_bid_lines').insert(
      bidLineRows.map((r) => ({
        id: randomUUID(),
        tender_bid_id: bid!.id,
        tender_line_id: r.tender_line_id,
        unit_price: r.unit_price,
        created_at: now,
      })),
    )
  }

  // On submit, advance the invitation status + log it.
  if (body.submit) {
    const invStatus = wasSubmitted ? 'bid_revised' : 'bid_submitted'
    await sb.from('tender_invitations').update({ status: invStatus }).eq('id', invitation.id)
    await logTenderActivity(
      params.id,
      wasSubmitted ? 'bid_revised' : 'submitted',
      eff.user.full_name,
      `Totalsum ${total}`,
    )
  }

  return NextResponse.json(bid)
}
