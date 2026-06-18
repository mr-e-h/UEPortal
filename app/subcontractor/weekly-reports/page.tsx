/**
 * UE weekly-reports list — React Server Component.
 *
 * Auth flow:
 *   1. Session guaranteed non-null (subcontractor layout redirects to /login).
 *   2. getEffectiveUser honours the "view-as" super-admin override.
 *   3. subId resolved from the effective user — NEVER from URL parameters.
 *   4. getSubcontractorWeeklyReports() fetches projects + current-week reports
 *      server-side in parallel.
 *
 * The client island (WeeklyReportsClient) is seeded with initialProjects,
 * initialReports, initialYear and initialWeek so it renders immediately without
 * a blank screen or spinner. When the user navigates to a different week the
 * island fetches client-side via /api/weekly-reports (only the reports, not the
 * full project list which is stable).
 *
 * UE-PRIS-ISOLASJON: weekly_reports and projects tables carry no customer-price
 * fields. No stripping is required here. The project loader (getSubcontractor-
 * Projects) already excludes customer pricing.
 */

import { getSession } from '@/lib/auth'
import { getEffectiveUser } from '@/lib/view-as'
import { getCurrentWeek } from '@/lib/utils/weeks'
import { getSubcontractorWeeklyReports } from '@/lib/subcontractor-weekly-reports'
import WeeklyReportsClient from './WeeklyReportsClient'

export default async function SubcontractorWeeklyReportsPage() {
  const realUser = await getSession()
  if (!realUser) return null

  const me = await getEffectiveUser(realUser)
  const subId = me.subcontractor_id ?? ''

  const { year, week } = getCurrentWeek()

  const { projects, reports } = await getSubcontractorWeeklyReports(subId, year, week)

  return (
    <WeeklyReportsClient
      subId={subId}
      initialProjects={projects}
      initialReports={reports}
      initialYear={year}
      initialWeek={week}
    />
  )
}
