import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { hashToken, safeCompareHash } from '@/lib/tokens'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import type { User, Invitation } from '@/types'

const BCRYPT_COST = 12

export async function POST(request: NextRequest) {
  const { email, password, full_name, token } = await request.json() as {
    email: string
    password: string
    full_name: string
    token?: string
  }

  if (!email || !password || !full_name) {
    return NextResponse.json({ error: 'E-post, passord og navn er påkrevd' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Passord må være minst 8 tegn' }, { status: 400 })
  }
  if (!token) {
    return NextResponse.json({ error: 'Invitasjonstoken er påkrevd for registrering' }, { status: 400 })
  }

  const ip = clientIp(request)
  const byIp = await rateLimit({ key: `register:ip:${ip}`, limit: 10, windowMs: 60_000 })
  if (!byIp.ok) {
    return NextResponse.json({ error: 'For mange forsøk, prøv igjen senere' }, { status: 429 })
  }

  // Validate the invitation token BEFORE the email-existence check so a
  // generic "invalid invitation" response covers both cases. Without this,
  // a 409 on email-in-use would let an attacker enumerate registered emails
  // by trying any random token + a guessed email.
  const hashed = hashToken(token)
  const sb = getSupabaseAdmin()
  const { data: inv } = await sb
    .from('invitations')
    .select('*')
    .eq('token_hash', hashed)
    .maybeSingle<Invitation>()

  if (!inv || !safeCompareHash(inv.token_hash, hashed)) {
    return NextResponse.json({ error: 'Ugyldig eller utløpt invitasjon' }, { status: 400 })
  }
  if (inv.accepted_at) return NextResponse.json({ error: 'Ugyldig eller utløpt invitasjon' }, { status: 400 })
  if (new Date(inv.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Ugyldig eller utløpt invitasjon' }, { status: 400 })
  }
  if (inv.email.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: 'E-postadressen samsvarer ikke med invitasjonen' }, { status: 400 })
  }

  const lowered = email.toLowerCase()
  const { data: existingUser } = await sb
    .from('users')
    .select('id')
    .ilike('email', lowered)
    .maybeSingle<{ id: string }>()
  if (existingUser) {
    return NextResponse.json({ error: 'E-postadressen er allerede i bruk' }, { status: 409 })
  }

  // Atomically claim the invitation — only the matching id+null-accepted_at
  // can be flipped, so a concurrent registration loses the race cleanly.
  const now = new Date().toISOString()
  const { data: claimedInv, error: claimErr } = await sb
    .from('invitations')
    .update({ accepted_at: now })
    .eq('id', inv.id)
    .is('accepted_at', null)
    .select()
    .maybeSingle<Invitation>()
  if (claimErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!claimedInv) {
    return NextResponse.json({ error: 'Ugyldig eller utløpt invitasjon' }, { status: 409 })
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_COST)

  const newUser: User = {
    id: randomUUID(),
    email: lowered,
    password: hashedPassword,
    role: inv.role,
    full_name,
    subcontractor_id: null,
    active: true,
  }

  const { error: userErr } = await sb.from('users').insert(newUser)
  if (userErr) {
    // Best-effort rollback of invitation claim so a transient DB hiccup
    // doesn't strand the user.
    await sb.from('invitations').update({ accepted_at: null }).eq('id', inv.id)
    return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, role: inv.role })
}
