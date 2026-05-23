import { redirect } from 'next/navigation'

/**
 * `company`-role is currently treated as an admin (ADMIN_ROLES in lib/roles.ts).
 * The dedicated /company portal was never implemented — we ship the admin
 * experience for now and bounce any direct visit. When/if company gets its
 * own dashboard, replace this with a real page.
 */
export default function CompanyPage() {
  redirect('/admin')
}
