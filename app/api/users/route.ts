import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { clearAllSessionsForUser } from '@/lib/auth'
import { requireUserAdmin } from '@/lib/api-guard'
import { SUPER_ADMIN_EMAIL } from '@/lib/view-as'
import type { User } from '@/types'

const BCRYPT_COST = 12

export async function GET() {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('users')
    .select('id, email, role, full_name, subcontractor_id, active')
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as Omit<User, 'password'>[])
}

export async function POST(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    email: string
    password: string
    full_name: string
    role: User['role']
    subcontractor_id?: string | null
  }

  if (!body.email || !body.password || !body.full_name || !body.role) {
    return NextResponse.json({ error: 'Mangler påkrevde felt' }, { status: 400 })
  }
  if (body.password.length < 8) {
    return NextResponse.json({ error: 'Passord må være minst 8 tegn' }, { status: 400 })
  }

  const email = body.email.toLowerCase()
  const sb = getSupabaseAdmin()
  // Check unique email — case-insensitive.
  const { data: existing } = await sb
    .from('users')
    .select('id')
    .ilike('email', email)
    .maybeSingle<{ id: string }>()
  if (existing) {
    return NextResponse.json({ error: 'E-post er allerede i bruk' }, { status: 409 })
  }

  const newUser: User = {
    id: randomUUID(),
    email,
    password: await bcrypt.hash(body.password, BCRYPT_COST),
    full_name: body.full_name,
    role: body.role,
    subcontractor_id: body.role === 'sub' ? (body.subcontractor_id ?? null) : null,
    active: true,
  }

  const { error } = await sb.from('users').insert(newUser)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  const { password: _pw, ...safe } = newUser
  return NextResponse.json(safe, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response
  const session = auth.user

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Mangler id' }, { status: 400 })
  if (id === session.id) return NextResponse.json({ error: 'Kan ikke slette egen bruker' }, { status: 400 })

  // Look the target up first so we can apply guards (and give a clean 404
  // message before doing anything destructive).
  const sb = getSupabaseAdmin()
  const { data: target } = await sb
    .from('users')
    .select('id, email, role')
    .eq('id', id)
    .maybeSingle<Pick<User, 'id' | 'email' | 'role'>>()
  if (!target) return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })

  // Guardrail: the hardcoded super-admin email cannot be deleted via the UI.
  // If they're ever locked out we'd rather see a clear error here than have
  // the only account with view-as access gone.
  if (target.email === SUPER_ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Super-admin-kontoen kan ikke slettes' }, { status: 400 })
  }

  // Drop sessions first so an inflight request can't keep going on a stale id.
  await clearAllSessionsForUser(id)

  // Clean up rows that reference this user_id but DON'T cascade automatically:
  //   - project_managers: PM assignments held by this user
  //   - access_requests rows where this user was the reviewer
  // (Audit-log activity rows store the actor's NAME as text, not user_id, so
  //  they keep their historical accuracy automatically.)
  await sb.from('project_managers').delete().eq('user_id', id)

  const { error, count } = await sb
    .from('users')
    .delete({ count: 'exact' })
    .eq('id', id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })
  return NextResponse.json({ ok: true, deleted: { id: target.id, email: target.email } })
}
