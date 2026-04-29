import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import type { User } from '@/types'
import { getSession } from '@/lib/auth'

export async function GET() {
  const session = await getSession()
  if (!session || (session.role !== 'main' && session.role !== 'project_manager')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const users = readJson<User>('users.json').map(({ password: _pw, ...u }) => u)
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

  const users = readJson<User>('users.json')
  if (users.some((u) => u.email.toLowerCase() === body.email.toLowerCase())) {
    return NextResponse.json({ error: 'E-post er allerede i bruk' }, { status: 409 })
  }

  const newUser: User = {
    id: String(Date.now()),
    email: body.email.toLowerCase(),
    password: body.password,
    full_name: body.full_name,
    role: body.role,
    subcontractor_id: body.role === 'sub' ? (body.subcontractor_id ?? null) : null,
  }

  writeJson('users.json', [...users, newUser])
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

  const users = readJson<User>('users.json')
  const filtered = users.filter((u) => u.id !== id)
  if (filtered.length === users.length) return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })

  writeJson('users.json', filtered)
  return NextResponse.json({ ok: true })
}
