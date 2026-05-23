/**
 * Server Component for /admin/time-types. Ships the three datasets the page
 * needs (time-types, subcontractors, sub-prices for the average-cost prefill)
 * with the initial HTML.
 */

import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { ADMIN_ROLES } from '@/lib/roles'
import type { TimeType, Subcontractor, SubcontractorProductPrice } from '@/types'
import TimeTypesClient from './TimeTypesClient'

export const dynamic = 'force-dynamic'

export default async function TimeTypesPage() {
  const me = await getSession()
  if (!me || !ADMIN_ROLES.includes(me.role)) redirect('/login')

  const sb = getSupabaseAdmin()
  const [ttRes, subsRes, pricesRes] = await Promise.all([
    sb.from('time_types').select('*'),
    sb.from('subcontractors').select('*'),
    sb.from('subcontractor_product_prices').select('*'),
  ])

  return (
    <TimeTypesClient
      initialTimeTypes={(ttRes.data ?? []) as TimeType[]}
      initialSubcontractors={(subsRes.data ?? []) as Subcontractor[]}
      initialSubPrices={(pricesRes.data ?? []) as SubcontractorProductPrice[]}
    />
  )
}
