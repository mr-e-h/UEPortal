/**
 * Server-side data loader for the UE (subcontractor) weekly-reports list page.
 *
 * Extracts the logic previously inline-called via /api/subcontractor/projects
 * and /api/weekly-reports so the new RSC page seeds its initial state without
 * extra HTTP hops.
 *
 * UE-PRIS-ISOLASJON: only sub-scoped data is returned. Weekly reports carry no
 * customer-price fields — no stripping is needed for this endpoint, but the
 * project list is fetched via getSubcontractorProjects() which also exposes no
 * customer pricing. The weekly_reports table itself has no pricing fields.
 *
 * Auth contract:
 *   - subId is the already-resolved effective sub id from the session. Never
 *     read from the URL.
 *   - subId falsy → return empty (view-as without a sub).
 *   - year / weekNumber scope the report list to a single ISO week. These are
 *     only used for the initial seed; the client island fetches fresh data when
 *     the user navigates weeks.
 */

import { getSupabaseAdmin } from './supabase'
import { getDeletedProjectIds } from './data'
import { getSubcontractorProjects } from './subcontractor-projects'
import type { WeeklyReport } from '@/types'

export type SubProjectLite = {
  id: string
  name: string
  project_number: string
  status: string
}

export type SubcontractorWeeklyReportsData = {
  projects: SubProjectLite[]
  reports: WeeklyReport[]
}

export async function getSubcontractorWeeklyReports(
  subId: string,
  year: number,
  weekNumber: number,
): Promise<SubcontractorWeeklyReportsData> {
  if (!subId) return { projects: [], reports: [] }

  const sb = getSupabaseAdmin()

  const [rawProjects, reportRes, deletedProjectIds] = await Promise.all([
    getSubcontractorProjects(subId),
    sb
      .from('weekly_reports')
      .select('*')
      .eq('subcontractor_id', subId)
      .eq('year', year)
      .eq('week_number', weekNumber),
    getDeletedProjectIds(),
  ])

  const projects: SubProjectLite[] = rawProjects.map((p) => ({
    id: p.id,
    name: p.name,
    project_number: p.project_number,
    status: p.status,
  }))

  const allReports = (reportRes.data ?? []) as WeeklyReport[]
  const reports = allReports.filter((r) => !deletedProjectIds.has(r.project_id))

  return { projects, reports }
}
