import { redirect, notFound } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { ADMIN_ROLES } from '@/lib/roles'
import { getProjectScope } from '@/lib/api-guard'
import type {
  Tender, TenderLine, TenderInvitation, TenderBid, TenderBidLine, Project, Subcontractor,
} from '@/types'
import TenderDetailClient from './TenderDetailClient'

export const dynamic = 'force-dynamic'

export default async function TenderDetailPage({ params }: { params: { id: string } }) {
  const me = await getSession()
  if (!me || !ADMIN_ROLES.includes(me.role)) redirect('/login')

  const sb = getSupabaseAdmin()
  const { data: tender } = await sb
    .from('tenders')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<Tender>()
  if (!tender) notFound()

  // PM scope.
  const scope = await getProjectScope(me)
  if (scope && !scope.has(tender.project_id)) notFound()

  const [linesRes, invitesRes, bidsRes, projectRes] = await Promise.all([
    sb.from('tender_lines').select('*').eq('tender_id', params.id).order('sort_order'),
    sb.from('tender_invitations').select('*').eq('tender_id', params.id),
    sb.from('tender_bids').select('*').eq('tender_id', params.id).eq('is_current', true),
    sb.from('projects').select('id, name, project_number').eq('id', tender.project_id).maybeSingle(),
  ])

  const lines = (linesRes.data ?? []) as TenderLine[]
  const invitations = (invitesRes.data ?? []) as TenderInvitation[]
  const bids = (bidsRes.data ?? []) as TenderBid[]
  const project = (projectRes.data ?? null) as Pick<Project, 'id' | 'name' | 'project_number'> | null

  // Bid lines for the matrix.
  const bidIds = bids.map((b) => b.id)
  let bidLines: TenderBidLine[] = []
  if (bidIds.length > 0) {
    const { data } = await sb.from('tender_bid_lines').select('*').in('tender_bid_id', bidIds)
    bidLines = (data ?? []) as TenderBidLine[]
  }

  // Company names for invited UEs.
  const subIds = Array.from(new Set(invitations.map((i) => i.subcontractor_id)))
  let subs: Array<Pick<Subcontractor, 'id' | 'company_name'>> = []
  if (subIds.length > 0) {
    const { data } = await sb.from('subcontractors').select('id, company_name').in('id', subIds)
    subs = (data ?? []) as Array<Pick<Subcontractor, 'id' | 'company_name'>>
  }

  return (
    <TenderDetailClient
      tender={tender}
      project={project}
      lines={lines}
      invitations={invitations}
      bids={bids}
      bidLines={bidLines}
      subcontractors={subs}
    />
  )
}
