import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { generateToken, hashToken, safeCompareHash } from './tokens'
import { getSupabaseAdmin } from './supabase'
import { readJson } from './data'
import type { User } from '@/types'

const SESSION_COOKIE = 'session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface SessionRow {
  id: string
  user_id: string
  token_hash: string
  expires_at: string
}

/**
 * Look up the current user from the session cookie. The cookie holds a
 * crypto-random token whose SHA-256 hash is stored in the `sessions` table;
 * we never trust user IDs in the cookie itself.
 */
export async function getSession(): Promise<User | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const hash = hashToken(token)
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('sessions')
    .select('id, user_id, token_hash, expires_at')
    .eq('token_hash', hash)
    .maybeSingle<SessionRow>()
  if (error || !data) return null
  if (!safeCompareHash(data.token_hash, hash)) return null
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await sb.from('sessions').delete().eq('id', data.id)
    return null
  }

  const users = await readJson<User>('users.json')
  return users.find((u) => u.id === data.user_id) ?? null
}

/**
 * Create a new session for the given user. Returns nothing; the caller's
 * response sets the cookie automatically via next/headers.
 */
export async function setSession(userId: string): Promise<void> {
  const rawToken = generateToken()
  const sb = getSupabaseAdmin()
  await sb.from('sessions').insert({
    id: randomUUID(),
    user_id: userId,
    token_hash: hashToken(rawToken),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    path: '/',
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}

/**
 * Invalidate just the current session (logout) — deletes the row and the cookie.
 */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    const sb = getSupabaseAdmin()
    await sb.from('sessions').delete().eq('token_hash', hashToken(token))
  }
  cookieStore.delete(SESSION_COOKIE)
}

/**
 * Wipe every active session for the user — used after password change/reset
 * so a stolen cookie cannot continue to authenticate.
 */
export async function clearAllSessionsForUser(userId: string): Promise<void> {
  const sb = getSupabaseAdmin()
  await sb.from('sessions').delete().eq('user_id', userId)
  // Also drop the caller's own cookie so this request flow stops being logged in.
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}
