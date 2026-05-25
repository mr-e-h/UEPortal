import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireUserAdmin } from '@/lib/api-guard'
import { generateToken, hashToken } from '@/lib/tokens'
import { sendEmail, buildAppUrl } from '@/lib/email'
import { invitationEmail } from '@/lib/email-templates'
import { roleLabel } from '@/lib/roles'
import type { AccessRequest, Invitation } from '@/types'

/**
 * Admin-only: approve or reject an access request.
 *
 * On approve:
 *   - Mark the request 'approved'
 *   - Create an Invitation row with the requested role (defaults to subcontractor)
 *   - Email the requester an acceptance link, so they self-onboard
 *
 * On reject:
 *   - Mark the request 'rejected' with an optional admin note
 *   - Do not email — silent decline
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({})) as Partial<{
    action: 'approve' | 'reject'
    role: 'project_manager' | 'sub'
    note: string
  }>

  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: 'action må være "approve" eller "reject"' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const { data: existing, error: readErr } = await sb
    .from('access_requests')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<AccessRequest>()

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Forespørsel ikke funnet' }, { status: 404 })
  if (existing.status !== 'pending') {
    return NextResponse.json({ error: 'Forespørselen er allerede behandlet' }, { status: 409 })
  }

  if (body.action === 'reject') {
    const { error } = await sb
      .from('access_requests')
      .update({
        status: 'rejected',
        decided_at: new Date().toISOString(),
        decided_by: auth.user.id,
        decision_note: body.note ?? null,
      })
      .eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  // ----- approve -----
  const role = body.role === 'project_manager' ? 'project_manager' : (existing.desired_role ?? 'sub')

  // If the email already corresponds to an existing user, just mark approved
  // and do NOT issue an invitation token. Admin can hand the user a reset link
  // from the users page instead.
  const { data: existingUser } = await sb
    .from('users')
    .select('id')
    .eq('email', existing.email)
    .maybeSingle<{ id: string }>()

  let invitationCreated = false
  if (!existingUser) {
    // Drop any prior pending invitation for the same email so we don't collide.
    await sb
      .from('invitations')
      .delete()
      .eq('email', existing.email)
      .is('accepted_at', null)

    const now = new Date()
    const expires = new Date(now)
    expires.setDate(expires.getDate() + 7)
    const rawToken = generateToken()

    const invitation: Invitation = {
      id: randomUUID(),
      email: existing.email,
      role,
      token_hash: hashToken(rawToken),
      created_at: now.toISOString(),
      expires_at: expires.toISOString(),
      accepted_at: null,
    }

    const { error: invErr } = await sb.from('invitations').insert(invitation)
    if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })

    const acceptUrl = buildAppUrl(`/accept-invite/${rawToken}`, req.url)
    try {
      await sendEmail({
        to: existing.email,
        content: invitationEmail({ acceptUrl, role: roleLabel(role), invitedBy: auth.user.full_name }),
      })
    } catch (err) {
      console.error('access-request approve email send failed:', err)
      // Invitation row exists; admin can resend manually.
    }
    invitationCreated = true
  }

  const { error: updErr } = await sb
    .from('access_requests')
    .update({
      status: 'approved',
      decided_at: new Date().toISOString(),
      decided_by: auth.user.id,
      decision_note: body.note ?? null,
    })
    .eq('id', params.id)

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, status: 'approved', invitation_sent: invitationCreated })
}

/**
 * Admin-only: delete an access request entirely. Used for spam cleanup.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const { error } = await getSupabaseAdmin()
    .from('access_requests')
    .delete()
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
