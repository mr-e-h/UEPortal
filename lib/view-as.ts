import { cookies } from 'next/headers'
import { getSupabaseAdmin } from './supabase'
import type { User } from '@/types'

/**
 * "View as <user>" feature — lets the hardcoded super-admin browse the app
 * as if they WERE another specific user, to see exactly what that user sees.
 *
 * Security model (CRITICAL):
 *
 *   1. Only ONE account can use this: the hardcoded super-admin email.
 *      Even another `main` account cannot trigger view-as unless their
 *      email matches SUPER_ADMIN_EMAIL.
 *
 *   2. view-as is READ-ONLY in spirit. /api/me, page guards, sidebar
 *      and UI filtering all see the impersonated user — but mutation
 *      gates (requireAdmin, requireSubcontractor) still resolve the
 *      REAL session user via getSession(), so audit trails always show
 *      the real actor. If the super-admin (viewing as a sub) submits
 *      a sub-only form, the API will refuse it because the real role
 *      is `main`, not `sub`. That's the intended trade-off.
 *
 *   3. Cookie value is a user id; the actual user record (id, email,
 *      role, subcontractor_id) is always loaded from the database, so
 *      a tampered cookie just yields a null lookup.
 */

export const VIEW_AS_COOKIE = 'view_as_user_id'

/** The single account allowed to use view-as. Hardcoded so a compromised
 *  `main` row in the users table cannot grant itself view-as access. */
export const SUPER_ADMIN_EMAIL = 'mhelsing94@gmail.com'

export function isSuperAdmin(user: User | null | undefined): boolean {
  return !!user && user.email === SUPER_ADMIN_EMAIL && user.role === 'main'
}

/**
 * Read the view-as cookie. Returns null if not set.
 * Does NOT check permission — callers should pair with isSuperAdmin().
 */
export async function getViewAsUserId(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(VIEW_AS_COOKIE)?.value ?? null
}

/**
 * Returns the user as it should appear to READ-side gates and UI:
 *  - For the super-admin with view-as set: the impersonated user (full
 *    row from DB), unless lookup fails (cookie stale / user deleted /
 *    deactivated), in which case fall back to the real user.
 *  - For anyone else: the real user unchanged.
 *
 * Use this for: page guards, /api/me, sidebar filtering, conditional UI.
 *
 * Do NOT use this for write authorization. Server endpoints should keep
 * calling requireAdmin/requireSubcontractor with the raw session user so
 * audit trails always reflect the real actor.
 */
export async function getEffectiveUser(realUser: User): Promise<User> {
  if (!isSuperAdmin(realUser)) return realUser
  const targetId = await getViewAsUserId()
  if (!targetId || targetId === realUser.id) return realUser

  const { data: target } = await getSupabaseAdmin()
    .from('users')
    .select('*')
    .eq('id', targetId)
    .maybeSingle<User>()
  if (!target || target.active === false) return realUser
  return target
}
