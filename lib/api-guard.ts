import { NextResponse } from 'next/server'
import { getSession } from './auth'
import { getSupabaseAdmin } from './supabase'
import { ADMIN_ROLES, SUB_ROLES } from './roles'
import type { User } from '@/types'

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse }

export async function requireAuth(): Promise<AuthResult> {
  const user = await getSession()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 }) }
  }
  return { ok: true, user }
}

export async function requireAdmin(): Promise<AuthResult> {
  const result = await requireAuth()
  if (!result.ok) return result
  if (!ADMIN_ROLES.includes(result.user.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 }) }
  }
  return result
}

export async function requireSubcontractor(): Promise<AuthResult> {
  const result = await requireAuth()
  if (!result.ok) return result
  if (!SUB_ROLES.includes(result.user.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 }) }
  }
  if (!result.user.subcontractor_id) {
    return { ok: false, response: NextResponse.json({ error: 'Ingen underentreprenør koblet til brukeren' }, { status: 403 }) }
  }
  return result
}

export function isAdmin(user: User): boolean {
  return ADMIN_ROLES.includes(user.role)
}

export function isSub(user: User): boolean {
  return SUB_ROLES.includes(user.role)
}

/**
 * Project-scope resolver. Returns:
 *   - `null` when the user sees everything (main / company / sub via
 *     project_subcontractors / non-admin non-PM roles)
 *   - `Set<string>` of allowed project_ids when the user is project_manager
 *     (scoped via the project_managers table)
 *
 * Callers should treat `null` as "no filter" and the set as a whitelist:
 *
 *   const scope = await getProjectScope(user)
 *   if (scope) query.in('project_id', Array.from(scope))
 */
export async function getProjectScope(user: User): Promise<Set<string> | null> {
  if (user.role !== 'project_manager') return null
  const { data } = await getSupabaseAdmin()
    .from('project_managers')
    .select('project_id')
    .eq('user_id', user.id)
  return new Set((data ?? []).map((r: { project_id: string }) => r.project_id))
}
