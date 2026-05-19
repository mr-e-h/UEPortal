import { cookies } from 'next/headers'
import { readJson } from './data'
import type { User } from '@/types'

const SESSION_COOKIE = 'session_user_id'

export async function getSession(): Promise<User | null> {
  const cookieStore = await cookies()
  const userId = cookieStore.get(SESSION_COOKIE)?.value
  if (!userId) return null

  const users = readJson<User>('users.json')
  return users.find((u) => u.id === userId) ?? null
}

export async function setSession(userId: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7,
  })
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}
