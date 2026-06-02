/**
 * Server Component — ships product catalog + price coverage with the
 * initial HTML so the page renders without the "Laster..." flash.
 * Interactivity lives in ProductsClient.
 */

import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { ADMIN_ROLES } from '@/lib/roles'
import type { Product, SubcontractorProductPrice, Subcontractor } from '@/types'
import ProductsClient from './ProductsClient'

export const dynamic = 'force-dynamic'

export default async function ProductsPage() {
  const me = await getSession()
  if (!me || !ADMIN_ROLES.includes(me.role)) redirect('/login')

  const sb = getSupabaseAdmin()
  const [prodsRes, pricesRes, subsRes] = await Promise.all([
    sb.from('products').select('*'),
    sb.from('subcontractor_product_prices').select('*'),
    sb.from('subcontractors').select('id, company_name, county, active'),
  ])
  const initialProducts = (prodsRes.data ?? []) as Product[]
  const initialPrices = (pricesRes.data ?? []) as SubcontractorProductPrice[]
  const initialSubcontractors = (subsRes.data ?? []) as Pick<Subcontractor, 'id' | 'company_name' | 'county' | 'active'>[]

  return (
    <ProductsClient
      initialProducts={initialProducts}
      initialPrices={initialPrices}
      initialSubcontractors={initialSubcontractors}
    />
  )
}
