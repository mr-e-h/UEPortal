import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSupabaseAdmin } from '@/lib/supabase'
import { hashToken, safeCompareHash } from '@/lib/tokens'
import { clearAllSessionsForUser } from '@/lib/auth'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import type { User, PasswordReset } from '@/types'

const BCRYPT_COST = 12

async function findValidReset(rawToken: string): Promise<PasswordReset | null> {
  const hashed = hashToken(rawToken)
  const { data } = await getSupabaseAdmin()
    .from('password_resets')
    .select('*')
    .eq('token_hash', hashed)
    .maybeSingle<PasswordReset>()
  if (!data) return null
  // Defense-in-depth — DB filter already did equality, but the helper makes
  // the comparison-is-secure intent explicit.
  if (!safeCompareHash(data.token_hash, hashed)) return null
  if (data.used_at !== null) return null
  if (new Date(data.expires_at).getTime() < Date.now()) return null
  return data
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!token) return NextResponse.json({ valid: false }, { status: 400 })
  return NextResponse.json({ valid: !!(await findValidReset(token)) })
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

  const ip = clientIp(request)
  const byIp = await rateLimit({ key: `reset:ip:${ip}`, limit: 30, windowMs: 60_000 })
  if (!byIp.ok) {
    return NextResponse.json({ error: 'For mange forsøk, prøv igjen senere' }, { status: 429 })
  }

  const reset = await findValidReset(token)
  if (!reset) {
    return NextResponse.json({ error: 'Lenken er ugyldig eller utløpt' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const { data: user } = await sb
    .from('users')
    .select('id, active')
    .eq('id', reset.user_id)
    .maybeSingle<Pick<User, 'id' | 'active'>>()
  if (!user) {
    return NextResponse.json({ error: 'Lenken er ugyldig eller utløpt' }, { status: 400 })
  }
  if (user.active === false) {
    return NextResponse.json({ error: 'Kontoen er deaktivert. Kontakt admin.' }, { status: 403 })
  }

  // Atomically claim the reset row — only the matching id with used_at IS
  // NULL is flipped. A concurrent click on the same link loses the race.
  const { data: claimed } = await sb
    .from('password_resets')
    .update({ used_at: new Date().toISOString() })
    .eq('id', reset.id)
    .is('used_at', null)
    .select()
    .maybeSingle<PasswordReset>()
  if (!claimed) {
    return NextResponse.json({ error: 'Lenken er allerede brukt' }, { status: 409 })
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_COST)
  await sb.from('users').update({ password: hashedPassword }).eq('id', user.id)

  // Wipe every active session — the reset flow often starts because the
  // user suspects compromise.
  await clearAllSessionsForUser(reset.user_id)

  return NextResponse.json({ ok: true })
}
