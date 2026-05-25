import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth'
import { isSuperAdmin, VIEW_AS_COOKIE } from '@/lib/view-as'
import { isProd } from '@/lib/env'
import type { UserRole } from '@/types'

/**
 * Set or clear the view-as override cookie. Only the hardcoded super-admin
 * can call this — every other caller, including other `main` accounts, gets
 * a 403 even if they manually craft the request.
 *
 * POST { role: UserRole | null }  — set cookie (null = clear)
 * DELETE                          — clear cookie
 */

const VALID: ReadonlyArray<UserRole> = ['main', 'project_manager', 'company', 'sub']

function denied(): NextResponse {
  return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  if (!isSuperAdmin(user)) return denied()

  const body = await request.json().catch(() => ({})) as { role?: unknown }
  const role = body.role
  const cookieStore = await cookies()

  if (role === null || role === undefined || role === '') {
    cookieStore.delete(VIEW_AS_COOKIE)
    return NextResponse.json({ ok: true, viewAs: null })
  }

  if (typeof role !== 'string' || !(VALID as ReadonlyArray<string>).includes(role)) {
    return NextResponse.json({ error: 'Ugyldig rolle' }, { status: 400 })
  }

  // If the super-admin "views as main", that's a no-op — just clear.
  if (role === user.role) {
    cookieStore.delete(VIEW_AS_COOKIE)
    return NextResponse.json({ ok: true, viewAs: null })
  }

  cookieStore.set(VIEW_AS_COOKIE, role, {
    httpOnly: true,
    path: '/',
    sameSite: 'strict',
    secure: isProd,
    // Short-lived — view-as is a debug aid, not a permanent state. 12 hours
    // is long enough to span an admin's working day without leaving a
    // forgotten override hanging around overnight.
    maxAge: 12 * 60 * 60,
  })
  return NextResponse.json({ ok: true, viewAs: role })
}

export async function DELETE() {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  if (!isSuperAdmin(user)) return denied()

  const cookieStore = await cookies()
  cookieStore.delete(VIEW_AS_COOKIE)
  return NextResponse.json({ ok: true, viewAs: null })
}
