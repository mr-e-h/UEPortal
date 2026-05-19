import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/data'
import { generateToken, hashToken } from '@/lib/tokens'
import { sendEmail, buildAppUrl } from '@/lib/email'
import { passwordResetEmail } from '@/lib/email-templates'
import type { User, PasswordReset } from '@/types'

const RESET_TTL_MS = 60 * 60 * 1000 // 1 hour

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const email = String(body?.email ?? '').trim().toLowerCase()

  // Always return 200 — do not reveal whether the email is registered.
  // This prevents account enumeration via the forgot-password endpoint.
  const response = NextResponse.json({ ok: true })

  if (!email) return response

  try {
    const users = readJson<User>('users.json')
    const user = users.find((u) => u.email.toLowerCase() === email)
    if (!user) return response

    const rawToken = generateToken()
    const now = new Date()

    const resets = readJson<PasswordReset>('password_resets.json')

    // Invalidate any earlier outstanding resets for this user — only the newest
    // link should work, so accidentally clicking an old link fails clearly.
    const cleaned = resets.map((r) =>
      r.user_id === user.id && r.used_at === null
        ? { ...r, used_at: now.toISOString() }
        : r
    )

    cleaned.push({
      id: randomUUID(),
      user_id: user.id,
      token_hash: hashToken(rawToken),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + RESET_TTL_MS).toISOString(),
      used_at: null,
    })
    writeJson('password_resets.json', cleaned)

    const resetUrl = buildAppUrl(`/reset-password/${rawToken}`, request.url)
    await sendEmail({ to: user.email, content: passwordResetEmail({ resetUrl }) })
  } catch (err) {
    // Log internally, but never let send failures leak to the client (would
    // reveal account existence). The reset link is best-effort.
    console.error('forgot-password error:', err)
  }

  return response
}
