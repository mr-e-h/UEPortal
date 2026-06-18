/**
 * UE change-orders list — React Server Component.
 *
 * Auth flow:
 *   1. Session guaranteed non-null (subcontractor layout redirects to /login).
 *   2. getEffectiveUser honours the "view-as" super-admin override.
 *   3. subId resolved from the effective user — NEVER from URL parameters.
 *   4. Both loaders run in parallel server-side (projects + change orders).
 *
 * The client island (ChangeOrdersClient) receives pre-fetched data as props
 * and renders immediately — no blank screen or spinner on mount.
 *
 * UE-PRIS-ISOLASJON:
 *   - getSubcontractorChangeOrders() strips customer_price_snapshot,
 *     total_customer_value and profit from every row before returning — exactly
 *     as the original API route did. This loader is the single source of truth
 *     for that stripping; neither the island nor the API route duplicates it.
 *   - getSubcontractorProjects() returns only cost-side figures (budget_value
 *     etc.); no customer pricing fields are queried or returned.
 */

import { getSession } from '@/lib/auth'
import { getEffectiveUser } from '@/lib/view-as'
import { getSubcontractorProjects } from '@/lib/subcontractor-projects'
import { getSubcontractorChangeOrders } from '@/lib/subcontractor-change-orders'
import ChangeOrdersClient from './ChangeOrdersClient'

export default async function SubcontractorChangeOrdersPage() {
  const realUser = await getSession()
  if (!realUser) return null

  const me = await getEffectiveUser(realUser)
  const subId = me.subcontractor_id ?? ''

  // Fetch projects and change orders in parallel.
  const [initialProjects, initialChangeOrders] = await Promise.all([
    getSubcontractorProjects(subId),
    getSubcontractorChangeOrders(subId),
  ])

  return (
    <ChangeOrdersClient
      initialChangeOrders={initialChangeOrders}
      initialProjects={initialProjects}
    />
  )
}
