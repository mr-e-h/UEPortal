import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { Invitation } from '@/types'
import { randomUUID } from 'crypto'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const invitations = readJson<Invitation>('invitations.json')
  return NextResponse.json(invitations)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { email, role } = await request.json() as { email: string; role: 'project_manager' | 'subcontractor' }

  if (!email || !role) {
    return NextResponse.json({ error: 'Mangler e-post eller rolle' }, { status: 400 })
  }

  const invitations = readJson<Invitation>('invitations.json')

  const pending = invitations.find((i) => i.email === email && i.accepted_at === null)
  if (pending) {
    return NextResponse.json({ error: 'Det finnes allerede en aktiv invitasjon for denne e-posten' }, { status: 409 })
  }

  const now = new Date()
  const expires = new Date(now)
  expires.setDate(expires.getDate() + 7)

  const invitation: Invitation = {
    id: String(Date.now()),
    email,
    role,
    token: randomUUID(),
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    accepted_at: null,
  }

  writeJson('invitations.json', [...invitations, invitation])
  return NextResponse.json(invitation, { status: 201 })
}
