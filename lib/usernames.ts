import type { User, Subcontractor } from '@/types'
import { ADMIN_ROLES } from './roles'

type UserDisplayInput = Pick<User, 'role' | 'full_name'>
type SubDisplayInput = Pick<Subcontractor, 'company_name'>

/**
 * Display username derived from full name + company. Mirrors the convention used
 * for the in-house admin/PM team: `<COMPANY>.<First>.<Last>` (no diacritics, no spaces).
 *   Admin:              MINUE.Agnete.Arnesveen
 *   UE for "Foo AS":    FOO.Per.Hansen
 */
export function displayUsername(user: UserDisplayInput, sub?: SubDisplayInput | null): string {
  const parts = user.full_name.trim().split(/\s+/).filter(Boolean)
  const first = sanitize(parts[0] ?? '')
  const last = sanitize(parts.slice(1).join('.') || '')
  const company = ADMIN_ROLES.includes(user.role)
    ? 'MINUE'
    : sanitize((sub?.company_name ?? '').split(/\s+/)[0] || 'UE')
  return [company, first, last].filter(Boolean).join('.')
}

/**
 * Display company name: "MinUE" for admin roles, the subcontractor's
 * registered company_name for UE roles.
 */
export function displayCompany(user: Pick<User, 'role'>, sub?: SubDisplayInput | null): string {
  if (ADMIN_ROLES.includes(user.role)) return 'MinUE'
  return sub?.company_name ?? '–'
}

function sanitize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[æÆ]/g, 'A').replace(/[øØ]/g, 'O').replace(/[åÅ]/g, 'A')
    .replace(/[^a-zA-Z0-9]/g, '')
}
