import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-guard'
import { getCachedSubcontractors, getCachedProducts, getCachedSubcontractorPrices } from '@/lib/cache'
import type { Subcontractor, Product, SubcontractorProductPrice } from '@/types'

/**
 * Single-call endpoint for /admin/subcontractors. Returns everything the
 * page needs (subs + products + prices + pre-computed missing-count per UE)
 * in one round-trip, avoiding 3 separate function cold-starts.
 *
 * All three tables are served from the Vercel Data Cache so the transatlantic
 * DB hop is avoided on cache hits (revalidated on any mutation).
 *
 * Users are intentionally NOT included — the page only needs them when a
 * row is expanded, so they stay on a separate lazy endpoint.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  // Resolve from Vercel Data Cache — parallel, one cold-start.
  const [subs, products, prices] = await Promise.all([
    getCachedSubcontractors(),
    getCachedProducts(),
    getCachedSubcontractorPrices(),
  ])

  // Types satisfied by the cached getters — cast for downstream use.
  const subsTyped = subs as Subcontractor[]
  const productsTyped = products as Product[]
  const pricesTyped = prices as Pick<SubcontractorProductPrice, 'subcontractor_id' | 'product_id'>[]

  // Compute missing-price counts server-side so the page can render without
  // any heavy aggregation work. Saves the price-array round-trip too.
  const productIds = new Set(products.map((p) => p.id))
  const haveByUE = new Map<string, Set<string>>()
  for (const p of prices) {
    if (!productIds.has(p.product_id)) continue
    let set = haveByUE.get(p.subcontractor_id)
    if (!set) { set = new Set(); haveByUE.set(p.subcontractor_id, set) }
    set.add(p.product_id)
  }

  const productCount = products.length
  const subcontractors = subs.map((s) => ({
    ...s,
    missing_prices: productCount - (haveByUE.get(s.id)?.size ?? 0),
  }))

  return NextResponse.json({ subcontractors, product_count: productCount })
}
