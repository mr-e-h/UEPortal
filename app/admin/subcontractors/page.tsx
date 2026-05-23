/**
 * Server Component — fetches subcontractors + missing-price counts directly
 * via Supabase and ships them with the initial HTML. Identical aggregation
 * logic to /api/admin/subcontractors-overview; the client uses that endpoint
 * for re-fetch after mutations.
 *
 * Wins vs the previous client-side fetch:
 *   - No "Laster..." flash; data is in the first paint
 *   - Auth resolves once on the server (not on top of a separate /api call)
 *   - One server function instead of fetch → /api/.. → server function
 */

import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { ADMIN_ROLES } from '@/lib/roles'
import type { Subcontractor, Product, SubcontractorProductPrice } from '@/types'
import SubcontractorsClient, { type SubWithMissing } from './SubcontractorsClient'

export const dynamic = 'force-dynamic'

export default async function SubcontractorsPage() {
  const me = await getSession()
  if (!me || !ADMIN_ROLES.includes(me.role)) {
    redirect('/login')
  }

  const sb = getSupabaseAdmin()
  const [subsRes, prodsRes, pricesRes] = await Promise.all([
    sb.from('subcontractors').select('*'),
    sb.from('products').select('id'),
    sb.from('subcontractor_product_prices').select('subcontractor_id, product_id'),
  ])

  const subs = (subsRes.data ?? []) as Subcontractor[]
  const productIds = new Set(((prodsRes.data ?? []) as Pick<Product, 'id'>[]).map((p) => p.id))
  const prices = (pricesRes.data ?? []) as Pick<SubcontractorProductPrice, 'subcontractor_id' | 'product_id'>[]

  // Pre-aggregate the missing-price count per UE so the client doesn't have
  // to ship/process the full prices table.
  const haveByUE = new Map<string, Set<string>>()
  for (const p of prices) {
    if (!productIds.has(p.product_id)) continue
    let set = haveByUE.get(p.subcontractor_id)
    if (!set) { set = new Set(); haveByUE.set(p.subcontractor_id, set) }
    set.add(p.product_id)
  }
  const productCount = productIds.size
  const initialSubcontractors: SubWithMissing[] = subs.map((s) => ({
    ...s,
    missing_prices: productCount - (haveByUE.get(s.id)?.size ?? 0),
  }))

  return <SubcontractorsClient initialSubcontractors={initialSubcontractors} />
}
