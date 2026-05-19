import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { readJson, writeJson } from '@/lib/data'
import { hashToken, safeCompareHash } from '@/lib/tokens'
import { clearAllSessionsForUser } from '@/lib/auth'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import type { User, PasswordReset } from '@/types'

const BCRYPT_COST = 12

async function findValidReset(rawToken: string): Promise<{ reset: PasswordReset; resets: PasswordReset[]; idx: number } | null> {
  const hashed = hashToken(rawToken)
  const resets = await readJson<PasswordReset>('password_resets.json')
  const now = Date.now()

  for (let i = 0; i < resets.length; i++) {
    const r = resets[i]
    if (!safeCompareHash(r.token_hash, hashed)) continue
    if (r.used_at !== null) return null
    if (new Date(r.expires_at).getTime() < now) return null
    return { reset: r, resets, idx: i }
  }
  return null
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!token) return NextResponse.json({ valid: false }, { status: 400 })

  const found = await findValidReset(token)
  return NextResponse.json({ valid: !!found })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const token = String(body?.token ?? '')
  const password = String(body?.password ?? '')

  if (!token || !password) {
    return NextResponse.json({ error: 'Token og passord er påkrevd' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Passord må være minst 8 tegn' }, { status: 400 })
  }

  // Rate-limit by IP to slow brute-forcing the 256-bit token space.
  const ip = clientIp(request)
  const byIp = await rateLimit({ key: `reset:ip:${ip}`, limit: 30, windowMs: 60_000 })
  if (!byIp.ok) {
    return NextResponse.json({ error: 'For mange forsøk, prøv igjen senere' }, { status: 429 })
  }

  const found = await findValidReset(token)
  if (!found) {
    return NextResponse.json({ error: 'Lenken er ugyldig eller utløpt' }, { status: 400 })
  }

  const { reset, resets, idx } = found

  const users = await readJson<User>('users.json')
  const userIdx = users.findIndex((u) => u.id === reset.user_id)
  if (userIdx === -1) {
    return NextResponse.json({ error: 'Lenken er ugyldig eller utløpt' }, { status: 400 })
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_COST)
  users[userIdx] = { ...users[userIdx], password: hashedPassword }
  await writeJson('users.json', users)

  resets[idx] = { ...reset, used_at: new Date().toISOString() }
  await writeJson('password_resets.json', resets)

  // Invalidate every session for this user — reset-flow is often started
  // exactly because the user suspects compromise.
  await clearAllSessionsForUser(reset.user_id)

  return NextResponse.json({ ok: true })
}
