import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import { generateToken, hashToken } from '@/lib/tokens'
import { sendEmail, buildAppUrl } from '@/lib/email'
import { invitationEmail } from '@/lib/email-templates'
import { roleLabel } from '@/lib/roles'
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

  const body = await request.json() as { email: string; role: 'project_manager' | 'subcontractor' }
  const email = String(body.email ?? '').trim().toLowerCase()
  const role = body.role

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

  const rawToken = generateToken()

  const invitation: Invitation = {
    id: randomUUID(),
    email,
    role,
    token_hash: hashToken(rawToken),
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    accepted_at: null,
  }

  writeJson('invitations.json', [...invitations, invitation])

  const acceptUrl = buildAppUrl(`/accept-invite/${rawToken}`, request.url)
  try {
    await sendEmail({
      to: email,
      content: invitationEmail({ acceptUrl, role: roleLabel(role), invitedBy: auth.user.full_name }),
    })
  } catch (err) {
    console.error('invitation email send failed:', err)
    // The invitation row is still persisted; admin can resend manually.
  }

  // Do not include the raw token in the response — it's only delivered via
  // the email link. The admin lists invitations by id/email/expires, not token.
  return NextResponse.json({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expires_at: invitation.expires_at,
    accepted_at: null,
  }, { status: 201 })
}
