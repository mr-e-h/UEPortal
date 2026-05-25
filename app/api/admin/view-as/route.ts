import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { isSuperAdmin, VIEW_AS_COOKIE } from '@/lib/view-as'
import { isProd } from '@/lib/env'
import type { User } from '@/types'

/**
 * Set or clear the view-as override. Only the hardcoded super-admin can
 * call this — every other caller, including other `main` accounts, gets
 * 403 even if they craft the request manually.
 *
 * POST { userId: string | null }  — impersonate that user (null = clear)
 * DELETE                          — clear cookie
 */

function denied(): NextResponse {
  return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  if (!isSuperAdmin(user)) return denied()

  const body = await request.json().catch(() => ({})) as { userId?: unknown }
  const targetId = body.userId
  const cookieStore = await cookies()

  // null / empty = clear the impersonation
  if (targetId === null || targetId === undefined || targetId === '') {
    cookieStore.delete(VIEW_AS_COOKIE)
    return NextResponse.json({ ok: true, view_as: null })
  }

  if (typeof targetId !== 'string') {
    return NextResponse.json({ error: 'Ugyldig brukerID' }, { status: 400 })
  }

  // Impersonating yourself = clear.
  if (targetId === user.id) {
    cookieStore.delete(VIEW_AS_COOKIE)
    return NextResponse.json({ ok: true, view_as: null })
  }

  // Confirm the target exists and is active before setting the cookie —
  // avoids leaving the super-admin in a phantom-user state.
  const { data: target } = await getSupabaseAdmin()
    .from('users')
    .select('id, active, role, full_name, email')
    .eq('id', targetId)
    .maybeSingle<Pick<User, 'id' | 'active' | 'role' | 'full_name' | 'email'>>()
  if (!target) {
    return NextResponse.json({ error: 'Brukeren finnes ikke' }, { status: 404 })
  }
  if (target.active === false) {
    return NextResponse.json({ error: 'Brukeren er deaktivert' }, { status: 400 })
  }

  cookieStore.set(VIEW_AS_COOKIE, targetId, {
    httpOnly: true,
    path: '/',
    sameSite: 'strict',
    secure: isProd,
    // Short-lived debug aid, not a permanent state. 12h spans a working
    // day without leaving forgotten overrides hanging around overnight.
    maxAge: 12 * 60 * 60,
  })
  return NextResponse.json({
    ok: true,
    view_as: {
      id: target.id,
      email: target.email,
      full_name: target.full_name,
      role: target.role,
    },
  })
}

export async function DELETE() {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  if (!isSuperAdmin(user)) return denied()

  const cookieStore = await cookies()
  cookieStore.delete(VIEW_AS_COOKIE)
  return NextResponse.json({ ok: true, view_as: null })
}
