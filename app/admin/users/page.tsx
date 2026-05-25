/**
 * Server Component — fetches data directly via Supabase and ships it with
 * the initial HTML. The actual table UI lives in <UsersClient> for the
 * interactive parts (search, sort, CSV export, click-through).
 *
 * Pilot for the RSC migration pattern. Other pages should follow the same
 * shape: page.tsx is a server component that does N parallel queries via
 * getSupabaseAdmin and passes typed props to a *Client.tsx companion.
 *
 * Wins vs the old client-only version:
 *   - No "Laster..." flash; data is in the first paint
 *   - 1 function invocation instead of 3 separate /api fetches
 *   - Auth resolved once on the server, not 3× from the browser
 */

import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { isUserAdmin } from '@/lib/api-guard'
import UsersClient, { type SafeUser, type SubcontractorLite, type InvitationLite } from './UsersClient'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const me = await getSession()
  if (!me) redirect('/login')
  // Bouncing PMs to the admin dashboard makes more sense than /login —
  // they're a legitimate admin user, just not a user-management one.
  if (!isUserAdmin(me)) redirect('/admin')

  const sb = getSupabaseAdmin()
  const [usersRes, subsRes, invRes] = await Promise.all([
    sb.from('users').select('id, email, role, full_name, subcontractor_id, active'),
    sb.from('subcontractors').select('id, company_name'),
    sb.from('invitations').select('id, email, role, expires_at, accepted_at'),
  ])

  const initialUsers = (usersRes.data ?? []) as SafeUser[]
  const subcontractors = (subsRes.data ?? []) as SubcontractorLite[]
  const initialInvitations = (invRes.data ?? []) as InvitationLite[]

  return (
    <UsersClient
      initialUsers={initialUsers}
      subcontractors={subcontractors}
      initialInvitations={initialInvitations}
    />
  )
}
