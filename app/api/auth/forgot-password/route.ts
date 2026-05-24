import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { generateToken, hashToken } from '@/lib/tokens'
import { sendEmail, buildAppUrl } from '@/lib/email'
import { passwordResetEmail } from '@/lib/email-templates'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import type { User, PasswordReset } from '@/types'

const RESET_TTL_MS = 60 * 60 * 1000 // 1 hour

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const email = String(body?.email ?? '').trim().toLowerCase()

  // Always return 200 — never reveal whether the email is registered.
  const response = NextResponse.json({ ok: true })
  if (!email) return response

  // Rate-limit reset requests. Per-email bounds prevent inbox spam; per-IP
  // bounds prevent reset-flooding. Silently drop on overflow.
  const ip = clientIp(request)
  const byIp = await rateLimit({ key: `forgot:ip:${ip}`, limit: 10, windowMs: 60_000 })
  const byEmail = await rateLimit({ key: `forgot:email:${email}`, limit: 3, windowMs: 15 * 60_000 })
  if (!byIp.ok || !byEmail.ok) return response

  try {
    const sb = getSupabaseAdmin()
    const { data: user } = await sb
      .from('users')
      .select('id, email, active')
      .ilike('email', email)
      .maybeSingle<Pick<User, 'id' | 'email' | 'active'>>()
    if (!user) return response
    // Quietly skip deactivated accounts — same generic response prevents
    // enumeration. Reset-password endpoint also enforces this.
    if (user.active === false) return response

    const rawToken = generateToken()
    const now = new Date()

    // Invalidate any outstanding resets for this user — only the newest link
    // should work. Targeted update by user_id where used_at is null.
    await sb
      .from('password_resets')
      .update({ used_at: now.toISOString() })
      .eq('user_id', user.id)
      .is('used_at', null)

    const newReset: PasswordReset = {
      id: randomUUID(),
      user_id: user.id,
      token_hash: hashToken(rawToken),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + RESET_TTL_MS).toISOString(),
      used_at: null,
    }
    await sb.from('password_resets').insert(newReset)

    const resetUrl = buildAppUrl(`/reset-password/${rawToken}`, request.url)
    await sendEmail({ to: user.email, content: passwordResetEmail({ resetUrl }) })
  } catch (err) {
    // Log internally; never let send failures leak (would reveal account existence).
    console.error('forgot-password error:', err)
  }

  return response
}
