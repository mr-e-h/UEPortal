import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireUserAdmin } from '@/lib/api-guard'
import { generateToken, hashToken } from '@/lib/tokens'
import { sendEmail, buildAppUrl } from '@/lib/email'
import { invitationEmail } from '@/lib/email-templates'
import { roleLabel } from '@/lib/roles'
import type { Invitation } from '@/types'

export async function GET() {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('invitations')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as Invitation[])
}

export async function POST(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { email: string; role: 'project_manager' | 'sub' }
  const email = String(body.email ?? '').trim().toLowerCase()
  const role = body.role

  if (!email || !role) {
    return NextResponse.json({ error: 'Mangler e-post eller rolle' }, { status: 400 })
  }
  if (role !== 'project_manager' && role !== 'sub') {
    return NextResponse.json({ error: 'Ugyldig rolle' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  // Block on a non-expired pending invitation for the same email.
  const nowIso = new Date().toISOString()
  const { data: pending } = await sb
    .from('invitations')
    .select('id')
    .eq('email', email)
    .is('accepted_at', null)
    .gt('expires_at', nowIso)
    .limit(1)
    .maybeSingle()
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

  const { error } = await sb.from('invitations').insert(invitation)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

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
  // the email link.
  return NextResponse.json({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expires_at: invitation.expires_at,
    accepted_at: null,
  }, { status: 201 })
}
