import type { UserRole } from '@/types'

type RoleKind = 'admin' | 'site' | 'sub' | 'other'

export interface RoleDefinition {
  value: UserRole
  label: string
  shortLabel: string
  kind: RoleKind
  badgeClass: string
}

export const ROLES: RoleDefinition[] = [
  {
    value: 'main',
    label: 'Admin',
    shortLabel: 'Admin',
    kind: 'admin',
    badgeClass: 'bg-blue-50 text-blue-700',
  },
  {
    value: 'project_manager',
    label: 'Prosjektleder',
    shortLabel: 'Prosjektleder',
    kind: 'admin',
    badgeClass: 'bg-blue-50 text-blue-700',
  },
  {
    value: 'company',
    label: 'Selskap',
    shortLabel: 'Selskap',
    kind: 'admin',
    badgeClass: 'bg-indigo-50 text-indigo-700',
  },
  {
    value: 'byggeleder',
    label: 'Byggeleder',
    shortLabel: 'Byggeleder',
    kind: 'site',
    badgeClass: 'bg-emerald-50 text-emerald-700',
  },
  {
    value: 'sub',
    label: 'Underentreprenør',
    shortLabel: 'UE',
    kind: 'sub',
    badgeClass: 'bg-amber-50 text-amber-700',
  },
]

const ROLE_BY_VALUE = new Map<UserRole, RoleDefinition>(ROLES.map((r) => [r.value, r]))

export function getRole(role: UserRole): RoleDefinition | undefined {
  return ROLE_BY_VALUE.get(role)
}

export function roleLabel(role: string): string {
  return ROLE_BY_VALUE.get(role as UserRole)?.label ?? role
}

export function roleBadgeClass(role: string): string {
  return ROLE_BY_VALUE.get(role as UserRole)?.badgeClass ?? 'bg-gray-100 text-gray-600'
}

export const ROLE_LABELS: Record<UserRole, string> = ROLES.reduce(
  (acc, r) => ({ ...acc, [r.value]: r.label }),
  {} as Record<UserRole, string>
)

export const ADMIN_ROLES: UserRole[] = ROLES.filter((r) => r.kind === 'admin').map((r) => r.value)
export const SUB_ROLES: UserRole[] = ROLES.filter((r) => r.kind === 'sub').map((r) => r.value)

/**
 * Project-operational staff: the admin roles PLUS byggeleder (site manager).
 * These roles render inside the /admin shell and may reach project-scoped
 * operational views (projects, weekly reports, change orders in follow-up
 * mode). It is intentionally BROADER than ADMIN_ROLES — byggeleder is NOT an
 * admin (no economy access, no final approvals, no user management).
 *
 * Use PROJECT_STAFF_ROLES for "may enter the admin shell / operational route".
 * Use ADMIN_ROLES for "full economy + approval authority".
 */
export const PROJECT_STAFF_ROLES: UserRole[] = ROLES
  .filter((r) => r.kind === 'admin' || r.kind === 'site')
  .map((r) => r.value)
