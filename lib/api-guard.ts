import { NextResponse } from 'next/server'
import { getSession } from './auth'
import type { User, UserRole } from '@/types'

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse }

const ADMIN_ROLES: UserRole[] = ['main', 'project_manager', 'company']
const SUB_ROLES: UserRole[] = ['subcontractor', 'sub']

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
