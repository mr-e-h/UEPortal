import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/data'
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
  const invitations = await readJson<Invitation>('invitations.json')
  const idx = invitations.findIndex((i) => safeCompareHash(i.token_hash, hashed))
  if (idx === -1) return NextResponse.json({ error: 'Ugyldig eller utløpt invitasjon' }, { status: 400 })
  const inv = invitations[idx]
  if (inv.accepted_at) return NextResponse.json({ error: 'Ugyldig eller utløpt invitasjon' }, { status: 400 })
  if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'Ugyldig eller utløpt invitasjon' }, { status: 400 })
  if (inv.email.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: 'E-postadressen samsvarer ikke med invitasjonen' }, { status: 400 })
  }

  const users = await readJson<User>('users.json')
  if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return NextResponse.json({ error: 'E-postadressen er allerede i bruk' }, { status: 409 })
  }

  const role = inv.role
  invitations[idx] = { ...inv, accepted_at: new Date().toISOString() }
  await writeJson('invitations.json', invitations)

  const hashedPassword = await bcrypt.hash(password, BCRYPT_COST)

  const newUser: User = {
    id: randomUUID(),
    email: email.toLowerCase(),
    password: hashedPassword,
    role,
    full_name,
    subcontractor_id: null,
  }

  await writeJson('users.json', [...users, newUser])

  return NextResponse.json({ ok: true, role })
}
