/**
 * Server Component — fetches pending access requests directly so the list
 * is in the first paint. Tab-switching (pending/approved/rejected/all)
 * triggers client-side re-fetch via /api/access-requests; only the initial
 * default-pending view is server-rendered.
 */

import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { isUserAdmin } from '@/lib/api-guard'
import type { AccessRequest } from '@/types'
import AccessRequestsClient from './AccessRequestsClient'

export const dynamic = 'force-dynamic'

export default async function AccessRequestsPage() {
  const me = await getSession()
  if (!me) redirect('/login')
  if (!isUserAdmin(me)) redirect('/admin')

  const { data } = await getSupabaseAdmin()
    .from('access_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  const initialRequests = (data ?? []) as AccessRequest[]
  return <AccessRequestsClient initialRequests={initialRequests} initialFilter="pending" />
}
