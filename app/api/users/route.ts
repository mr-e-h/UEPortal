import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/data'
import type { User } from '@/types'
import { getSession, clearAllSessionsForUser } from '@/lib/auth'

const BCRYPT_COST = 12

export async function GET() {
  const session = await getSession()
  if (!session || (session.role !== 'main' && session.role !== 'project_manager')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const users = (await readJson<User>('users.json')).map(({ password: _pw, ...u }) => u)
  return NextResponse.json(users)
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session || (session.role !== 'main' && session.role !== 'project_manager')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as {
    email: string
    password: string
    full_name: string
    role: 'main' | 'sub'
    subcontractor_id?: string | null
  }

  if (!body.email || !body.password || !body.full_name || !body.role) {
    return NextResponse.json({ error: 'Mangler påkrevde felt' }, { status: 400 })
  }
  if (body.password.length < 8) {
    return NextResponse.json({ error: 'Passord må være minst 8 tegn' }, { status: 400 })
  }

  const users = await readJson<User>('users.json')
  if (users.some((u) => u.email.toLowerCase() === body.email.toLowerCase())) {
    return NextResponse.json({ error: 'E-post er allerede i bruk' }, { status: 409 })
  }

  const newUser: User = {
    id: randomUUID(),
    email: body.email.toLowerCase(),
    password: await bcrypt.hash(body.password, BCRYPT_COST),
    full_name: body.full_name,
    role: body.role,
    subcontractor_id: body.role === 'sub' ? (body.subcontractor_id ?? null) : null,
    active: true,
  }

  await writeJson('users.json', [...users, newUser])
  const { password: _pw, ...safe } = newUser
  return NextResponse.json(safe, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session || (session.role !== 'main' && session.role !== 'project_manager')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Mangler id' }, { status: 400 })
  if (id === session.id) return NextResponse.json({ error: 'Kan ikke slette egen bruker' }, { status: 400 })

  const users = await readJson<User>('users.json')
  const filtered = users.filter((u) => u.id !== id)
  if (filtered.length === users.length) return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })

  await writeJson('users.json', filtered)
  // Drop any active session for the deleted user.
  await clearAllSessionsForUser(id)
  return NextResponse.json({ ok: true })
}
