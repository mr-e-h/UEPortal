import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { readJson, writeJson } from '@/lib/data'
import type { User } from '@/types'
import { getSession, clearAllSessionsForUser } from '@/lib/auth'

const BCRYPT_COST = 12

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { old_password, new_password } = await request.json() as { old_password: string; new_password: string }

  if (!new_password || new_password.length < 8) {
    return NextResponse.json({ error: 'Passord må være minst 8 tegn' }, { status: 400 })
  }

  const users = await readJson<User>('users.json')
  const user = users.find((u) => u.id === session.id)
  if (!user) return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })

  // bcrypt only — plaintext fallback removed; legacy accounts must reset.
  const oldValid = user.password.startsWith('$2') && await bcrypt.compare(old_password, user.password)
  if (!oldValid) {
    return NextResponse.json({ error: 'Feil nåværende passord' }, { status: 400 })
  }

  const hashed = await bcrypt.hash(new_password, BCRYPT_COST)
  await writeJson('users.json', users.map((u) => u.id === session.id ? { ...u, password: hashed } : u))

  // Invalidate every session for this user so a stolen cookie elsewhere stops working.
  await clearAllSessionsForUser(session.id)
  return NextResponse.json({ ok: true })
}
