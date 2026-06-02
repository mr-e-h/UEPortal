import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getDeletedProjectIds } from '@/lib/data'
import { isTenderExpired, resolveEffectiveSub } from '@/lib/tender'
import type { Tender, TenderInvitation, TenderBid } from '@/types'

/**
 * GET /api/subcontractor/tenders — tenders the current UE is invited to.
 *
 * Security: only invitations belonging to THIS subcontractor are read, and we
 * only return tenders that have actually been sent (never drafts). No
 * competitor data of any kind is included — just this UE's own invitation +
 * their own bid summary + the project name for context.
 *
 * Uses the EFFECTIVE subcontractor (resolveEffectiveSub) so the super-admin's
 * "view as" works here exactly like the rest of the UE portal.
 */
export async function GET() {
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  const subId = eff.subId

  const sb = getSupabaseAdmin()

  // The UE's invitations.
  const { data: inviteData } = await sb
    .from('tender_invitations')
    .select('*')
    .eq('subcontractor_id', subId)
  const invitations = (inviteData ?? []) as TenderInvitation[]
  if (invitations.length === 0) return NextResponse.json([])

  const tenderIds = invitations.map((i) => i.tender_id)

  const { data: tenderData } = await sb
    .from('tenders')
    .select('*')
    .in('id', tenderIds)
  let tenders = (tenderData ?? []) as Tender[]

  // Never show drafts (not yet published) or tenders on deleted projects.
  const deleted = await getDeletedProjectIds()
  tenders = tenders.filter((t) => t.status !== 'draft' && !deleted.has(t.project_id))

  // Project names for context.
  const projectIds = Array.from(new Set(tenders.map((t) => t.project_id)))
  const { data: projData } = projectIds.length
    ? await sb.from('projects').select('id, name, project_number').in('id', projectIds)
    : { data: [] }
  const projMap = new Map(
    ((projData ?? []) as Array<{ id: string; name: string; project_number: string }>)
      .map((p) => [p.id, p]),
  )

  // This UE's own current bids (for the summary badge — no competitor info).
  const { data: bidData } = await sb
    .from('tender_bids')
    .select('id, tender_id, status, total_cost, submitted_at, is_current')
    .eq('subcontractor_id', subId)
    .eq('is_current', true)
    .in('tender_id', tenderIds)
  const bidMap = new Map(
    ((bidData ?? []) as Pick<TenderBid, 'id' | 'tender_id' | 'status' | 'total_cost' | 'submitted_at' | 'is_current'>[])
      .map((b) => [b.tender_id, b]),
  )

  const inviteMap = new Map(invitations.map((i) => [i.tender_id, i]))

  const result = tenders.map((t) => {
    const proj = projMap.get(t.project_id)
    const bid = bidMap.get(t.id)
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      deadline_at: t.deadline_at,
      expired: isTenderExpired(t.deadline_at),
      project_name: proj?.name ?? '–',
      project_number: proj?.project_number ?? '',
      invitation_status: inviteMap.get(t.id)?.status ?? 'invited',
      my_bid_status: bid?.status ?? null,
      my_bid_total: bid?.total_cost ?? null,
      my_bid_submitted_at: bid?.submitted_at ?? null,
    }
  })

  return NextResponse.json(result)
}
