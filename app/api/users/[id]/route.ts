import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession, clearAllSessionsForUser } from '@/lib/auth'
import { USER_ADMIN_ROLES } from '@/lib/api-guard'
import { SUPER_ADMIN_EMAIL } from '@/lib/view-as'
import type { User } from '@/types'

const BCRYPT_COST = 12

function adminOnly(role: string): boolean {
  return USER_ADMIN_ROLES.includes(role as typeof USER_ADMIN_ROLES[number])
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await getSupabaseAdmin()
    .from('users')
    .select('id, email, role, full_name, subcontractor_id, active')
    .eq('id', params.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session || !adminOnly(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as Partial<Pick<User, 'full_name' | 'email' | 'role' | 'subcontractor_id' | 'active'>> & {
    password?: string
  }

  // Whitelist fields the admin is allowed to touch.
  const updates: Record<string, unknown> = {}
  if (body.full_name !== undefined) updates.full_name = body.full_name
  if (body.email !== undefined) updates.email = body.email.toLowerCase()
  if (body.role !== undefined) updates.role = body.role
  if (body.subcontractor_id !== undefined) updates.subcontractor_id = body.subcontractor_id
  if (body.active !== undefined) updates.active = body.active
  if (body.password) {
    if (body.password.length < 8) {
      return NextResponse.json({ error: 'Passord må være minst 8 tegn' }, { status: 400 })
    }
    updates.password = await bcrypt.hash(body.password, BCRYPT_COST)
  }

  // An admin demoting themselves out of an admin role would lock them out;
  // refuse the change to avoid a one-button lockout.
  if (params.id === session.id && updates.role && !adminOnly(String(updates.role))) {
    return NextResponse.json({ error: 'Kan ikke endre egen rolle bort fra admin' }, { status: 400 })
  }
  if (params.id === session.id && updates.active === false) {
    return NextResponse.json({ error: 'Kan ikke deaktivere egen bruker' }, { status: 400 })
  }

  // Super-admin protections: the account that uniquely holds view-as access
  // must not be demoted or deactivated by anyone (including another `main`).
  // Email change is OK if explicit — but only by the super-admin themselves.
  if (updates.role || updates.active === false || updates.email) {
    const { data: target } = await getSupabaseAdmin()
      .from('users')
      .select('email')
      .eq('id', params.id)
      .maybeSingle<{ email: string }>()
    if (target?.email === SUPER_ADMIN_EMAIL) {
      if (updates.role && updates.role !== 'main') {
        return NextResponse.json({ error: 'Super-admin må beholde rollen main' }, { status: 400 })
      }
      if (updates.active === false) {
        return NextResponse.json({ error: 'Super-admin kan ikke deaktiveres' }, { status: 400 })
      }
      if (updates.email && params.id !== session.id) {
        return NextResponse.json({ error: 'Bare super-admin selv kan endre denne e-posten' }, { status: 400 })
      }
    }
  }

  const { data, error } = await getSupabaseAdmin()
    .from('users')
    .update(updates)
    .eq('id', params.id)
    .select('id, email, role, full_name, subcontractor_id, active')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })

  // Security: if we changed password OR deactivated the user, wipe every
  // active session for them so a stolen cookie elsewhere stops working.
  if (updates.password !== undefined || updates.active === false) {
    await clearAllSessionsForUser(params.id)
  }

  return NextResponse.json(data)
}
