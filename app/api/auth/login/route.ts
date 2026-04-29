import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { readJson } from '@/lib/data'
import { setSession } from '@/lib/auth'
import type { User } from '@/types'

export async function POST(request: NextRequest) {
  const { email, password } = await request.json() as { email: string; password: string }

  if (!email || !password) {
    return NextResponse.json({ error: 'E-post og passord er påkrevd' }, { status: 400 })
  }

  const users = readJson<User>('users.json')
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase())

  if (!user) {
    return NextResponse.json({ error: 'Feil e-post eller passord' }, { status: 401 })
  }

  const passwordValid = user.password.startsWith('$2')
    ? await bcrypt.compare(password, user.password)
    : user.password === password // fallback for unhashed (dev migration)

  if (!passwordValid) {
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
