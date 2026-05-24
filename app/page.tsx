import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

/**
 * Root redirect: send each user to their role's home, falling back to
 * /login for anonymous visitors. Previously sent everyone to /dashboard,
 * which was a stub page (now deleted).
 */
export default async function Home() {
  const user = await getSession()
  if (!user) redirect('/login')

  if (user.role === 'sub') redirect('/subcontractor')
  // main, project_manager, company all use /admin (company is in ADMIN_ROLES;
  // dedicated /company portal doesn't exist yet).
  redirect('/admin')
}
