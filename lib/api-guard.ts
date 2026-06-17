import { NextResponse } from 'next/server'
import { cache } from 'react'
import { getSession } from './auth'
import { getSupabaseAdmin } from './supabase'
import { ADMIN_ROLES, PROJECT_STAFF_ROLES, SUB_ROLES } from './roles'
import type { User, UserRole } from '@/types'

/**
 * "User management" roles — the subset of admins allowed to see and modify
 * accounts, invitations, and access requests. Specifically EXCLUDES
 * project_manager: a PM is a project-scoped admin, not a company-wide
 * admin, and shouldn't be inviting users / approving access requests /
 * deleting other accounts.
 */
export const USER_ADMIN_ROLES: UserRole[] = ['main', 'company']

export function isUserAdmin(user: User): boolean {
  return USER_ADMIN_ROLES.includes(user.role)
}

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse }

export async function requireAuth(): Promise<AuthResult> {
  const user = await getSession()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 }) }
  }
  return { ok: true, user }
}

export async function requireAdmin(): Promise<AuthResult> {
  const result = await requireAuth()
  if (!result.ok) return result
  if (!ADMIN_ROLES.includes(result.user.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 }) }
  }
  return result
}

/**
 * Broader than requireAdmin — admits PROJECT_STAFF_ROLES (main / company /
 * project_manager / byggeleder). Use for project-scoped OPERATIONAL routes a
 * site manager must reach (e.g. follow up / approve weekly-report lines).
 *
 * IMPORTANT: this does NOT grant economy access or approval authority. Callers
 * that return customer economics must still gate output with
 * canSeeCustomerEconomics(), and routes for final EM approval / send-to-customer
 * / budgets must keep using requireAdmin (which excludes byggeleder).
 */
export async function requireStaff(): Promise<AuthResult> {
  const result = await requireAuth()
  if (!result.ok) return result
  if (!PROJECT_STAFF_ROLES.includes(result.user.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 }) }
  }
  return result
}

/**
 * Stricter than requireAdmin — only company-wide admins (main / company).
 * Use for user-management endpoints (users, invitations, access requests).
 * project_managers get a 403 here even though they're admins for project data.
 */
export async function requireUserAdmin(): Promise<AuthResult> {
  const result = await requireAuth()
  if (!result.ok) return result
  if (!USER_ADMIN_ROLES.includes(result.user.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 }) }
  }
  return result
}

export async function requireSubcontractor(): Promise<AuthResult> {
  const result = await requireAuth()
  if (!result.ok) return result
  if (!SUB_ROLES.includes(result.user.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 }) }
  }
  if (!result.user.subcontractor_id) {
    return { ok: false, response: NextResponse.json({ error: 'Ingen underentreprenør koblet til brukeren' }, { status: 403 }) }
  }
  return result
}

export function isAdmin(user: User): boolean {
  return ADMIN_ROLES.includes(user.role)
}

export function isSub(user: User): boolean {
  return SUB_ROLES.includes(user.role)
}

/**
 * The economy-visibility gate. TRUE only for roles allowed to see MinUE's
 * customer-side economics (customer_price, customer_price_snapshot,
 * total_customer_value, profit, margin): main / company / project_manager.
 *
 * FALSE for byggeleder AND sub — both must get the stripped, cost-only view.
 *
 * This is the explicit replacement for the old `isSub()` economy check: never
 * use `!isSub(user)` to decide economy exposure, because a byggeleder is not a
 * sub and would wrongly fall into the full-economy branch. Use
 * `canSeeCustomerEconomics(user)` instead. (Wired into the economy routes in
 * Pakke 3 — not yet applied here.)
 */
export function canSeeCustomerEconomics(user: User): boolean {
  return ADMIN_ROLES.includes(user.role)
}

/**
 * WRITE / ansvarlig-scope: prosjektene brukeren er TILDELT som den ene
 * prosjektlederen (project_managers) eller den ene byggelederen
 * (project_site_managers). Dette er skrive-/redigerings-scopet — interne
 * DELTAKERE (kun innsyn) er IKKE med her, så de aldri kan mutere et prosjekt.
 *
 *   - `null` for main/company (full tilgang) og sub (scopes via egne tabeller)
 *   - `Set<string>` (også tom!) for project_manager/byggeleder. Tom = tildelt
 *     ingen prosjekter → kan ikke skrive noe. Må ALDRI kollapse til null.
 *
 * Brukes av ensureProjectWritable og andre skrive-porter.
 */
export const getProjectWriteScope = cache(async (user: User): Promise<Set<string> | null> => {
  if (user.role === 'project_manager') {
    const { data } = await getSupabaseAdmin()
      .from('project_managers')
      .select('project_id')
      .eq('user_id', user.id)
    return new Set((data ?? []).map((r: { project_id: string }) => r.project_id))
  }
  if (user.role === 'byggeleder') {
    const { data } = await getSupabaseAdmin()
      .from('project_site_managers')
      .select('project_id')
      .eq('user_id', user.id)
    return new Set((data ?? []).map((r: { project_id: string }) => r.project_id))
  }
  return null
})

/**
 * READ / synlighets-scope: ansvarlig-scopet PLUSS prosjekter brukeren er intern
 * DELTAKER på (project_participants). Deltakere har innsyn (lese) men ikke
 * skrivetilgang — derfor er dette scopet bredere enn write-scopet. Brukes til
 * lister, sider og GET-filtrering.
 *
 *   - `null` for main/company (alt) og sub (egne tabeller)
 *   - `Set<string>` (også tom!) for project_manager/byggeleder. Tom = ser
 *     ingenting — må ALDRI kollapse til null.
 *
 *   const scope = await getProjectScope(user)
 *   if (scope) query.in('project_id', Array.from(scope))
 *   // tom Array.from(scope) håndteres som "ingenting" (isEmptyScope) — en tom
 *   // .in([]) er et no-op-filter.
 */
export const getProjectScope = cache(async (user: User): Promise<Set<string> | null> => {
  const write = await getProjectWriteScope(user)
  if (write === null) return null // main/company/sub
  const { data } = await getSupabaseAdmin()
    .from('project_participants')
    .select('project_id')
    .eq('user_id', user.id)
  const set = new Set(write)
  for (const r of (data ?? []) as { project_id: string }[]) set.add(r.project_id)
  return set
})

/**
 * Helper for the "empty scope = see nothing" hazard. A scoped role with no
 * assignments yields an empty Set; callers that filter with `.in('project_id',
 * [...])` must short-circuit to an empty result in that case, because an empty
 * `.in([])` is a no-op (would leak everything). Returns true when the user is
 * scoped to zero projects.
 *
 *   const scope = await getProjectScope(user)
 *   if (isEmptyScope(scope)) return NextResponse.json([])
 *
 * (Provided now for Pakke 3/4 to use; routes are not refactored in this pakke.)
 */
export function isEmptyScope(scope: Set<string> | null): boolean {
  return scope !== null && scope.size === 0
}

/**
 * Write-side gate. Used by POST/PUT/DELETE handlers to refuse mutations
 * against projects a project_manager isn't assigned to.
 *
 *   const denied = await ensureProjectWritable(auth.user, body.project_id)
 *   if (denied) return denied
 *
 * Returns a 403 NextResponse when the user is a PM not assigned to the
 * project, otherwise null. main / company always pass.
 */
export async function ensureProjectWritable(
  user: User,
  projectId: string,
): Promise<NextResponse | null> {
  // Skrive-scope: kun PL/byggeleder (ansvarlig) — deltakere (innsyn) blokkeres.
  const scope = await getProjectWriteScope(user)
  if (!scope) return null
  if (scope.has(projectId)) return null
  return NextResponse.json(
    { error: 'Du er ikke tildelt dette prosjektet' },
    { status: 403 },
  )
}

/**
 * Read-side "may this user touch this project at all?" check. UNLIKE
 * getProjectScope/ensureProjectWritable, this also covers SUBS — getProjectScope
 * returns null for a sub (because subs are scoped via project_subcontractors,
 * not the manager tables), so a naive scope check would wrongly treat a sub as
 * "sees everything". Resolves access per role:
 *   - main / company             → always (full visibility)
 *   - project_manager / byggeleder → only assigned projects
 *   - sub                        → only projects linked via project_subcontractors
 *
 * Use on routes a sub legitimately reaches (e.g. the project checklist) where a
 * plain ensureProjectWritable would either over-block (no sub path) or, worse,
 * skip the check entirely for non-admins.
 */
export async function userCanAccessProject(user: User, projectId: string): Promise<boolean> {
  if (isSub(user)) {
    if (!user.subcontractor_id) return false
    const { count } = await getSupabaseAdmin()
      .from('project_subcontractors')
      .select('project_id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('subcontractor_id', user.subcontractor_id)
    return !!count
  }
  const scope = await getProjectScope(user)
  return scope === null || scope.has(projectId)
}

/**
 * WRITE-side "may this user MUTATE this project?" — som userCanAccessProject,
 * men bruker WRITE-scopet for staff (PL/byggeleder), så rene innsyns-DELTAKERE
 * blokkeres fra mutasjoner. Subs scopes via project_subcontractors som før.
 * Brukes på delte mutasjoner som BÅDE subs og ansvarlig staff kan gjøre
 * (f.eks. avhuking i sjekklisten) — der ensureProjectWritable ville sluppet
 * gjennom subs (write-scope = null for subs) feilaktig.
 */
export async function userCanWriteProject(user: User, projectId: string): Promise<boolean> {
  if (isSub(user)) {
    if (!user.subcontractor_id) return false
    const { count } = await getSupabaseAdmin()
      .from('project_subcontractors')
      .select('project_id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('subcontractor_id', user.subcontractor_id)
    return !!count
  }
  const scope = await getProjectWriteScope(user)
  return scope === null || scope.has(projectId)
}
