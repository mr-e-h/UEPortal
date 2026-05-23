import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { Subcontractor, Product, SubcontractorProductPrice } from '@/types'

/**
 * Single-call endpoint for /admin/subcontractors. Returns everything the
 * page needs (subs + products + prices + pre-computed missing-count per UE)
 * in one round-trip, avoiding 3 separate function cold-starts.
 *
 * Users are intentionally NOT included — the page only needs them when a
 * row is expanded, so they stay on a separate lazy endpoint.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const sb = getSupabaseAdmin()

  // Parallel inside one function — one cold-start, three concurrent queries
  // against the same warm connection pool.
  const [subsRes, prodsRes, pricesRes] = await Promise.all([
    sb.from('subcontractors').select('*'),
    sb.from('products').select('*'),
    sb.from('subcontractor_product_prices').select('subcontractor_id, product_id'),
  ])

  if (subsRes.error) return NextResponse.json({ error: subsRes.error.message }, { status: 500 })
  if (prodsRes.error) return NextResponse.json({ error: prodsRes.error.message }, { status: 500 })
  if (pricesRes.error) return NextResponse.json({ error: pricesRes.error.message }, { status: 500 })

  const subs = (subsRes.data ?? []) as Subcontractor[]
  const products = (prodsRes.data ?? []) as Product[]
  const prices = (pricesRes.data ?? []) as Pick<SubcontractorProductPrice, 'subcontractor_id' | 'product_id'>[]

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
