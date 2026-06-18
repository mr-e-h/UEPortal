/**
 * Server-side data loader for the UE (subcontractor) change-orders list page.
 *
 * Extracts the data logic from /api/subcontractor/change-orders/route.ts so
 * that BOTH the API route AND the new RSC page.tsx can call it without
 * duplicating code or adding an extra HTTP hop.
 *
 * UE-PRIS-ISOLASJON: stripCustomerEconomics() is applied here exactly as the
 * original API route does — customer_price_snapshot, total_customer_value and
 * profit are stripped from every row before it leaves this function.
 * has_admin_edits and has_consequence_lines are computed with two bulk
 * round-trips (not N+1) exactly as the API route does.
 *
 * Auth contract:
 *   - Caller must have already resolved the effective subcontractor id.
 *   - subId falsy → return empty array (view-as without a sub).
 *   - projectId optional filter (used by the project-detail page's own fetch).
 */

import { getSupabaseAdmin } from './supabase'
import { readJson, getDeletedProjectIds } from './data'
import { stripCustomerEconomics } from './economy-isolation'
import type { ChangeOrder } from '@/types'

export type UEChangeOrder = Omit<
  ChangeOrder,
  'customer_price_snapshot' | 'total_customer_value' | 'profit'
> & {
  has_admin_edits: boolean
  has_consequence_lines: boolean
}

export async function getSubcontractorChangeOrders(
  subId: string,
  projectId?: string | null,
): Promise<UEChangeOrder[]> {
  if (!subId) return []

  const deletedProjectIds = await getDeletedProjectIds()
  const orders = await readJson<ChangeOrder>('change_orders.json')

  const filtered = orders.filter((o) => {
    if (deletedProjectIds.has(o.project_id)) return false
    if (o.subcontractor_id !== subId) return false
    if (projectId && o.project_id !== projectId) return false
    return true
  })

  const ids = filtered.map((o) => o.id)
  let editedSet = new Set<string>()
  let conseqSet = new Set<string>()
  if (ids.length > 0) {
    const sb = getSupabaseAdmin()
    const [editedRes, conseqRes] = await Promise.all([
      sb
        .from('activity_log')
        .select('entity_id')
        .eq('entity_type', 'change_order')
        .eq('action', 'edited')
        .in('entity_id', ids),
      sb
        .from('change_order_consequence_lines')
        .select('change_order_id')
        .in('change_order_id', ids),
    ])
    editedSet = new Set((editedRes.data ?? []).map((r: { entity_id: string }) => r.entity_id))
    conseqSet = new Set(
      (conseqRes.data ?? []).map((r: { change_order_id: string }) => r.change_order_id),
    )
  }

  return filtered.map((order) => {
    const rest = stripCustomerEconomics(order)
    return {
      ...rest,
      has_admin_edits: editedSet.has(rest.id),
      has_consequence_lines: conseqSet.has(rest.id),
    }
  })
}
