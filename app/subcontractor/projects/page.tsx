/**
 * UE projects list — React Server Component.
 *
 * Auth flow:
 *   1. Session guaranteed non-null here (subcontractor layout redirects to /login).
 *   2. getEffectiveUser honours the "view-as" super-admin override.
 *   3. subId resolved from the effective user — NEVER from URL parameters.
 *   4. getSubcontractorProjects() fetches all project data server-side.
 *
 * The client island (ProjectsListClient) receives pre-fetched data as
 * initialData and renders immediately — no blank screen, no spinner on mount.
 *
 * UE-PRIS-ISOLASJON: getSubcontractorProjects() only returns the sub's own
 * cost figures (budget_value, approved_value, invoiced_value). The three
 * customer-price fields (customer_price_snapshot, total_customer_value, profit)
 * are never queried or included in the response.
 */

import { getSession } from '@/lib/auth'
import { getEffectiveUser } from '@/lib/view-as'
import { getSubcontractorProjects } from '@/lib/subcontractor-projects'
import ProjectsListClient from './ProjectsListClient'

export default async function SubcontractorProjectsPage() {
  const realUser = await getSession()
  // Layout guarantees session; defensive guard here in case of edge cases.
  if (!realUser) return null

  const me = await getEffectiveUser(realUser)
  // View-as super-admin posing as a sub may have no subcontractor_id.
  const subId = me.subcontractor_id ?? ''

  const initialData = await getSubcontractorProjects(subId)

  return <ProjectsListClient initialData={initialData} />
}
