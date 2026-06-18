/**
 * Vercel Data Cache wrappers for read-mostly, slowly-changing lookup tables.
 *
 * WHY: Vercel functions run in US (iad1); Supabase DB is in EU (eu-west-1).
 * Each uncached SELECT crosses ~80 ms of Atlantic latency. The tables below
 * are fetched on almost every page load but change only when an admin edits
 * the catalogue/user list. Caching them server-side in the Vercel Data Cache
 * eliminates the transatlantic hop until data actually changes.
 *
 * SECURITY invariant — RAW rows are cached here, server-side only:
 *   - customer_price (products) is in the cached rows.
 *   - The cache result NEVER leaves this module to the client directly.
 *   - Per-request callers must apply the same stripping / gating they already
 *     do today (e.g. zeroing customer_price for sub/byggeleder roles), AFTER
 *     calling the getter. Nothing here changes authorization logic.
 *
 * REVALIDATION: every mutation endpoint (POST/PUT/DELETE) for a cached table
 * must call revalidateTag(<tagName>) after a successful write so stale data
 * is evicted. See the "Mutasjoner" comment at the bottom.
 *
 * revalidate: 3600 is a safety-net TTL (1 hour). The explicit revalidateTag()
 * calls on mutations make the effective staleness window near-zero in practice.
 */

import { unstable_cache } from 'next/cache'
import { getSupabaseAdmin } from './supabase'
import type { Product, Subcontractor, SubcontractorProductPrice, User } from '@/types'

// ─── products ────────────────────────────────────────────────────────────────
// Raw catalogue rows including customer_price. Caller strips per-request.

export const getCachedProducts = unstable_cache(
  async (): Promise<Product[]> => {
    const { data } = await getSupabaseAdmin().from('products').select('*')
    return (data ?? []) as Product[]
  },
  ['products'],
  { tags: ['products'], revalidate: 3600 },
)

// ─── subcontractors ──────────────────────────────────────────────────────────
// Full UE catalogue. UE-isolation (only own row) is enforced per-request in
// the route, not here.

export const getCachedSubcontractors = unstable_cache(
  async (): Promise<Subcontractor[]> => {
    const { data } = await getSupabaseAdmin().from('subcontractors').select('*')
    return (data ?? []) as Subcontractor[]
  },
  ['subcontractors'],
  { tags: ['subcontractors'], revalidate: 3600 },
)

// ─── subcontractor_product_prices ────────────────────────────────────────────
// All UE price rows. Admin-only endpoint; no UE ever calls this directly.

export const getCachedSubcontractorPrices = unstable_cache(
  async (): Promise<SubcontractorProductPrice[]> => {
    const { data } = await getSupabaseAdmin()
      .from('subcontractor_product_prices')
      .select('*')
    return (data ?? []) as SubcontractorProductPrice[]
  },
  ['subcontractor_product_prices'],
  { tags: ['subcontractor_product_prices'], revalidate: 3600 },
)

// ─── users ───────────────────────────────────────────────────────────────────
// Cached without the password column (select restricted to safe fields).
// Used by admin dropdown hydration, PM lists, and name lookups.

export const getCachedUsers = unstable_cache(
  async (): Promise<Omit<User, 'password'>[]> => {
    const { data } = await getSupabaseAdmin()
      .from('users')
      .select('id, email, role, full_name, subcontractor_id, active')
    return (data ?? []) as Omit<User, 'password'>[]
  },
  ['users'],
  { tags: ['users'], revalidate: 3600 },
)

// ─── Mutasjoner — oppdater denne listen om endepunkter legges til ─────────────
//
//  products:                    POST /api/products            → revalidateTag('products')
//                               PUT  /api/products/[id]       → revalidateTag('products')
//                               DELETE /api/products/[id]     → revalidateTag('products')
//                                                               + revalidateTag('subcontractor_product_prices')
//
//  subcontractors:              POST /api/subcontractors      → revalidateTag('subcontractors')
//
//  subcontractor_product_prices: POST /api/subcontractor-prices → revalidateTag('subcontractor_product_prices')
//                                PUT  /api/subcontractor-prices → revalidateTag('subcontractor_product_prices')
//
//  users:                       POST /api/users               → revalidateTag('users')
//                               DELETE /api/users             → revalidateTag('users')
//                               PATCH /api/users/[id]         → revalidateTag('users')
