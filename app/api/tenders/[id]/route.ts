import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type {
  Tender, TenderLine, TenderInvitation, TenderBid, TenderBidLine, TenderStatus,
} from '@/types'

/**
 * GET /api/tenders/[id] — full admin view of one tender: header, lines,
 * invitations (with UE company names), and ALL bids + bid lines so the client
 * can render the comparison matrix. Admin/PM only — UEs use the
 * /api/subcontractor/tenders endpoints which never expose competitor data.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const sb = getSupabaseAdmin()
  const { data: tender } = await sb
    .from('tenders')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<Tender>()
  if (!tender) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  // PM scope: refuse tenders on projects the PM isn't assigned to.
  const denied = await ensureProjectWritable(auth.user, tender.project_id)
  if (denied) return denied

  const [linesRes, invitesRes, bidsRes] = await Promise.all([
    sb.from('tender_lines').select('*').eq('tender_id', params.id).order('sort_order'),
    sb.from('tender_invitations').select('*').eq('tender_id', params.id),
    sb.from('tender_bids').select('*').eq('tender_id', params.id),
  ])

  const lines = (linesRes.data ?? []) as TenderLine[]
  const invitations = (invitesRes.data ?? []) as TenderInvitation[]
  const bids = (bidsRes.data ?? []) as TenderBid[]

  // Bid lines for all bids on this tender.
  const bidIds = bids.map((b) => b.id)
  let bidLines: TenderBidLine[] = []
  if (bidIds.length > 0) {
    const { data: blData } = await sb
      .from('tender_bid_lines')
      .select('*')
      .in('tender_bid_id', bidIds)
    bidLines = (blData ?? []) as TenderBidLine[]
  }

  // Company names for invited UEs (so the matrix can label columns).
  const subIds = Array.from(new Set(invitations.map((i) => i.subcontractor_id)))
  let subs: Array<{ id: string; company_name: string }> = []
  if (subIds.length > 0) {
    const { data: subData } = await sb
      .from('subcontractors')
      .select('id, company_name')
      .in('id', subIds)
    subs = (subData ?? []) as Array<{ id: string; company_name: string }>
  }

  return NextResponse.json({ tender, lines, invitations, bids, bidLines, subcontractors: subs })
}

type PatchBody = {
  title?: string
  description?: string
  deadline_at?: string | null
  status?: TenderStatus
}

const ALLOWED_STATUS: TenderStatus[] = [
  'draft', 'sent', 'open', 'expired', 'under_review', 'awarded', 'closed', 'cancelled',
]

/**
 * PATCH /api/tenders/[id] — edit header fields, extend the deadline, move to
 * under_review, cancel, or close. Awarding has its own endpoint (/award) since
 * it has budget side-effects.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const sb = getSupabaseAdmin()
  const { data: tender } = await sb
    .from('tenders')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<Tender>()
  if (!tender) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  const denied = await ensureProjectWritable(auth.user, tender.project_id)
  if (denied) return denied

  const body = await request.json() as PatchBody
  const updates: Partial<Tender> = { updated_at: new Date().toISOString() }

  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.description !== undefined) updates.description = body.description.trim()
  if (body.deadline_at !== undefined) updates.deadline_at = body.deadline_at
  if (body.status !== undefined) {
    if (!ALLOWED_STATUS.includes(body.status)) {
      return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
    }
    // Awarding must go through /award (budget side-effects). Block it here.
    if (body.status === 'awarded') {
      return NextResponse.json({ error: 'Bruk /award for å tildele' }, { status: 400 })
    }
    updates.status = body.status
  }

  const { data, error } = await sb
    .from('tenders')
    .update(updates)
    .eq('id', params.id)
    .select()
    .maybeSingle<Tender>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(data)
}
