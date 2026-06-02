import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getEffectiveUser, isSuperAdmin } from '@/lib/view-as'
import CompanyNav from '@/components/company/CompanyNav'
import ViewAsBar from '@/components/ViewAsBar'

/**
 * Company shell — server component. Resolves session + view-as on the server
 * so the shell renders in the initial HTML without a client /api/me gate. Role
 * gate mirrors the previous client useEffect: only company users render here;
 * everyone else is routed to their own portal.
 */
export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  const realUser = await getSession()
  if (!realUser) redirect('/login')
  const me = await getEffectiveUser(realUser)

  if (me.role !== 'company') {
    if (me.role === 'sub') redirect('/subcontractor')
    if (me.role === 'main' || me.role === 'project_manager') redirect('/admin')
    redirect('/login')
  }

  // Only the super-admin "viewing as" a company user sees the floating view-as
  // switcher; reserve header space for it only then.
  const canViewAs = isSuperAdmin(realUser)

  return (
    <div className="min-h-screen flex bg-[var(--color-bg-page)]">
      <CompanyNav userName={me.full_name} />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className={`h-16 flex-none bg-card border-b border-border flex items-center px-4 sm:px-6 gap-4 ${canViewAs ? 'pr-44' : ''}`}>
          <div className="flex-1" />
          <span className="text-sm text-[var(--color-text-secondary)] truncate max-w-[140px] sm:max-w-none">{me.full_name}</span>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>

      {canViewAs && <ViewAsBar />}
    </div>
  )
}
