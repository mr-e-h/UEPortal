import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import type { Invitation, User } from '@/types'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const invitations = readJson<Invitation>('invitations.json')
  const inv = invitations.find((i) => i.token === params.token)

  if (!inv) return NextResponse.json({ error: 'Invitasjon ikke funnet' }, { status: 404 })
  if (inv.accepted_at) return NextResponse.json({ error: 'Invitasjonen er allerede brukt' }, { status: 410 })
  if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'Invitasjonen har utløpt' }, { status: 410 })

  return NextResponse.json({ email: inv.email, role: inv.role })
}

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const { full_name, password } = await request.json() as { full_name: string; password: string }

  const invitations = readJson<Invitation>('invitations.json')
  const idx = invitations.findIndex((i) => i.token === params.token)

  if (idx === -1) return NextResponse.json({ error: 'Invitasjon ikke funnet' }, { status: 404 })

  const inv = invitations[idx]
  if (inv.accepted_at) return NextResponse.json({ error: 'Invitasjonen er allerede brukt' }, { status: 410 })
  if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'Invitasjonen har utløpt' }, { status: 410 })

  const users = readJson<User>('users.json')
  if (users.find((u) => u.email === inv.email)) {
    return NextResponse.json({ error: 'E-postadressen er allerede i bruk' }, { status: 409 })
  }

  const newUser: User = {
    id: String(Date.now()),
    email: inv.email,
    password,
    role: inv.role,
    full_name,
    subcontractor_id: null,
  }

  writeJson('users.json', [...users, newUser])

  invitations[idx] = { ...inv, accepted_at: new Date().toISOString() }
  writeJson('invitations.json', invitations)

  return NextResponse.json({ role: newUser.role })
}
