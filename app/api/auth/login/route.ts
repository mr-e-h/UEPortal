import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { readJson } from '@/lib/data'
import { setSession } from '@/lib/auth'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import type { User } from '@/types'

// Dummy bcrypt-comparable hash so we still spend ~80ms when the email is
// unknown. Without this, timing leaks "user exists" via the response time.
const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8.PRiV5HxYO6CG1jZ2QXBGw7Yg0kqu'

export async function POST(request: NextRequest) {
  const { email, password } = await request.json() as { email: string; password: string }

  if (!email || !password) {
    return NextResponse.json({ error: 'E-post og passord er påkrevd' }, { status: 400 })
  }

  // Rate-limit by IP and by email, lower whichever bound trips first.
  const ip = clientIp(request)
  const byIp = await rateLimit({ key: `login:ip:${ip}`, limit: 20, windowMs: 60_000 })
  const byEmail = await rateLimit({ key: `login:email:${email.toLowerCase()}`, limit: 8, windowMs: 60_000 })
  if (!byIp.ok || !byEmail.ok) {
    return NextResponse.json({ error: 'For mange forsøk, prøv igjen senere' }, { status: 429 })
  }

  const users = await readJson<User>('users.json')
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase())

  // Always run bcrypt — equal time whether user exists or not. bcrypt-only
  // (no plaintext fallback); legacy accounts must use the forgot-password flow.
  const hashToCheck = user?.password.startsWith('$2') ? user.password : DUMMY_HASH
  const passwordValid = (await bcrypt.compare(password, hashToCheck)) && !!user

  if (!passwordValid || !user) {
    return NextResponse.json({ error: 'Feil e-post eller passord' }, { status: 401 })
  }

  await setSession(user.id)

  return NextResponse.json({
    id: user.id,
    role: user.role,
    full_name: user.full_name,
    subcontractor_id: user.subcontractor_id,
  })
}
