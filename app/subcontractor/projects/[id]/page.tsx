/**
 * Subcontractor project-detail page — React Server Component.
 *
 * Auth flow:
 *   1. The subcontractor layout already verified the session and enforced the
 *      'sub' role gate (redirecting non-subs elsewhere). We still call
 *      getSession() here to drive the server loader, which resolves the
 *      effective sub identity (honouring super-admin view-as).
 *   2. loadSubcontractorProjectDetail() fetches the project + its enriched
 *      budget lines in a single parallel round-trip server-side.
 *      Returns null when the project does not exist or the sub is not linked
 *      to it via project_subcontractors → notFound().
 *
 * The client island (ProjectDetailClient) receives the pre-fetched project as
 * `initialData` and seeds its state immediately — no blank-screen spinner on
 * first render. Secondary data (history, change orders, milestones, phases)
 * is still fetched client-side on mount, as those are cheaper and less
 * important for first-paint.
 *
 * UE-PRIS-ISOLASJON: the server loader never selects customer-economics
 * fields. Only subcontractor_cost_price_snapshot and total_cost (UE-own) are
 * included, mirroring the GET /api/subcontractor/projects/[id] route exactly.
 */

import { notFound } from 'next/navigation'
import { loadSubcontractorProjectDetail } from '@/lib/subcontractor-project-detail'
import ProjectDetailClient from './ProjectDetailClient'

interface Props {
  params: { id: string }
}

export default async function SubcontractorProjectDetailPage({ params }: Props) {
  const initialData = await loadSubcontractorProjectDetail(params.id)

  // Project not found, deleted, or this sub is not linked to it.
  if (!initialData) notFound()

  return <ProjectDetailClient initialData={initialData} />
}
