import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { isSuperAdmin } from '@/lib/view-as'
import type { User, Subcontractor } from '@/types'

/**
 * List of all candidates the super-admin can impersonate. Active users only.
 * Returns enough info for the dropdown to label each option with name +
 * role + (for subs) company name.
 *
 * Locked to the hardcoded super-admin — anybody else gets 403.
 */
export async function GET() {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  if (!isSuperAdmin(user)) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const sb = getSupabaseAdmin()
  const [{ data: users }, { data: subs }] = await Promise.all([
    sb.from('users')
      .select('id, email, full_name, role, subcontractor_id, active')
      .eq('active', true)
      .order('role')
      .order('full_name'),
    sb.from('subcontractors').select('id, company_name'),
  ])

  const subMap = new Map((subs ?? []).map((s: Pick<Subcontractor, 'id' | 'company_name'>) => [s.id, s.company_name]))

  const list = (users ?? []).map((u: Pick<User, 'id' | 'email' | 'full_name' | 'role' | 'subcontractor_id'>) => ({
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role,
    company_name: u.subcontractor_id ? (subMap.get(u.subcontractor_id) ?? null) : null,
  }))

  return NextResponse.json(list)
}
