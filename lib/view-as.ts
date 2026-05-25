import { cookies } from 'next/headers'
import type { User, UserRole } from '@/types'

/**
 * "View as <role>" feature — lets the hardcoded super-admin browse the app
 * as if they had a different role, to verify what each role sees.
 *
 * Security model (CRITICAL):
 *
 *   1. Only ONE account can use this: the hardcoded super-admin email.
 *      Even an upgraded `main` account cannot trigger view-as unless
 *      their email matches SUPER_ADMIN_EMAIL.
 *
 *   2. view-as is READ-ONLY in spirit. It changes the role that page-level
 *      gates and the client UI see, so the super-admin can navigate as the
 *      target role would. But it does NOT change the user.id, user.email,
 *      or user.subcontractor_id — so existing role-based mutation gates
 *      (requireAdmin, requireSubcontractor, etc.) still check the REAL
 *      role. Mutations from a `main` user simply continue to work as `main`
 *      regardless of view-as.
 *
 *   3. Cookie value is validated against the known UserRole union — never
 *      trusted as raw input.
 *
 * Consequence: when admin "views as sub", they see what a sub sees, but if
 * they try to submit a sub-only form, the server will refuse it (real role
 * is `main`, not `sub`). That is the intended trade-off.
 */

export const VIEW_AS_COOKIE = 'view_as'

/** The single account allowed to use view-as. Hardcoded so a compromised
 *  `main` row in the users table cannot grant itself view-as access. */
export const SUPER_ADMIN_EMAIL = 'mhelsing94@gmail.com'

export function isSuperAdmin(user: User | null | undefined): boolean {
  return !!user && user.email === SUPER_ADMIN_EMAIL && user.role === 'main'
}

const VALID_ROLES: ReadonlyArray<UserRole> = ['main', 'project_manager', 'company', 'sub']

function parseRole(raw: string | undefined): UserRole | null {
  if (!raw) return null
  return (VALID_ROLES as ReadonlyArray<string>).includes(raw) ? (raw as UserRole) : null
}

/**
 * Read the view-as cookie. Returns null if not set or invalid.
 * Does NOT check permission — callers should pair with isSuperAdmin().
 */
export async function getViewAsRole(): Promise<UserRole | null> {
  const cookieStore = await cookies()
  return parseRole(cookieStore.get(VIEW_AS_COOKIE)?.value)
}

/**
 * Returns the user as it should appear to READ-side gates and UI:
 *  - For the super-admin with view-as set: real user but with overridden role
 *  - For anyone else: the real user unchanged
 *
 * Use this for: page guards (admin layout role check), /api/me, sidebar
 * filtering, conditional UI.
 *
 * Do NOT use this for: write authorization. Server endpoints should keep
 * calling requireAdmin/requireSubcontractor with the raw session user so
 * audit trails always reflect the real actor.
 */
export async function getEffectiveUser(realUser: User): Promise<User> {
  if (!isSuperAdmin(realUser)) return realUser
  const viewAs = await getViewAsRole()
  if (!viewAs || viewAs === realUser.role) return realUser
  return { ...realUser, role: viewAs }
}
