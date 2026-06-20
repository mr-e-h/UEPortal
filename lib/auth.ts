import { cookies } from 'next/headers'
import { cache } from 'react'
import { randomUUID } from 'crypto'
import { generateToken, hashToken, safeCompareHash } from './tokens'
import { getSupabaseAdmin } from './supabase'
import { isProd } from './env'
import { VIEW_AS_COOKIE } from './view-as'
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
 *
 * Wrapped in React.cache so multiple callers within one request share a
 * single lookup — endpoints that call requireAuth multiple times don't pay
 * the round-trip twice. Cache scope is per-request (Next.js handles teardown).
 */
export const getSession = cache(async (): Promise<User | null> => {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const hash = hashToken(token)
  const sb = getSupabaseAdmin()
  const { data: session, error } = await sb
    .from('sessions')
    .select('id, user_id, token_hash, expires_at')
    .eq('token_hash', hash)
    .maybeSingle<SessionRow>()
  if (error || !session) return null
  if (!safeCompareHash(session.token_hash, hash)) return null
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await sb.from('sessions').delete().eq('id', session.id)
    return null
  }

  // Targeted single-row lookup. The previous implementation read the entire
  // users table on every authenticated API call — fine at 7 rows, terrible
  // when it grows. Now it's an indexed PK lookup.
  const { data: user } = await sb
    .from('users')
    .select('*')
    .eq('id', session.user_id)
    .maybeSingle<User>()
  if (!user) return null
  // Treat a deactivated account as logged-out — admins toggle `active=false`
  // expecting the user's session to die immediately. (We also delete sessions
  // on the API path, but this catches any stragglers.)
  if (user.active === false) return null
  return user
})

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
    secure: isProd,
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
  // Also clear the "view as" cookie. Otherwise impersonation survives a
  // logout/login cycle: the cookie has a 12h maxAge and was never bound to the
  // session that created it, so a fresh login would silently re-impersonate.
  cookieStore.delete(VIEW_AS_COOKIE)
}

/**
 * Wipe every active session for the given user — used after a password
 * change/reset or when an admin deactivates/deletes someone, so any stolen
 * cookie elsewhere stops authenticating.
 *
 * NOTE: this is targeted at `userId` ONLY. It does NOT touch the caller's
 * own cookie. When an admin uses this against another user, the admin stays
 * logged in. When a user calls it against themselves (e.g. self-password
 * change), the handler should also call `clearSession()` if it wants the
 * caller's cookie cleared.
 */
export async function clearAllSessionsForUser(userId: string): Promise<void> {
  const sb = getSupabaseAdmin()
  await sb.from('sessions').delete().eq('user_id', userId)
}
