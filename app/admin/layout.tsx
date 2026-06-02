import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getEffectiveUser, isSuperAdmin } from '@/lib/view-as'
import AdminSidebarNav from '@/components/admin/AdminSidebarNav'
import HeaderSearch from '@/components/admin/HeaderSearch'
import LogoutButton from '@/components/LogoutButton'
import ViewAsBar from '@/components/ViewAsBar'

const USER_ADMIN_ROLES = ['main', 'company']

/**
 * Admin shell — server component. Resolves the session (and any view-as
 * override) on the server so the sidebar + header render in the initial HTML
 * with no client /api/me round-trip and no full-screen "Laster..." gate. The
 * interactive pieces (nav/drawer, search, logout) are small client islands.
 *
 * The role gate mirrors the previous client useEffect exactly: bounce subs to
 * their portal and anyone who isn't PM/main/company back to login. When the
 * super-admin "views as" a sub, getEffectiveUser returns role 'sub' and they
 * get routed to /subcontractor — exactly what the view-as dropdown promises.
 * Write authorization still runs against the REAL user inside each API route,
 * so audit trails are unaffected.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const realUser = await getSession()
  if (!realUser) redirect('/login')
  const me = await getEffectiveUser(realUser)

  if (me.role === 'sub') redirect('/subcontractor')
  if (me.role !== 'project_manager' && me.role !== 'main' && me.role !== 'company') {
    redirect('/login')
  }

  const isUserAdmin = USER_ADMIN_ROLES.includes(me.role)
  // The view-as switcher is a fixed, top-right floating button. Only the
  // super-admin ever sees it, so only then do we reserve right-hand space in
  // the header to stop it overlapping the username + logout.
  const canViewAs = isSuperAdmin(realUser)

  return (
    <div className="min-h-screen bg-[var(--color-bg-page)] flex justify-center">
      <div className="w-full max-w-[1600px] flex min-h-screen">
        <AdminSidebarNav isUserAdmin={isUserAdmin} />

        {/* Main area */}
        <div className="flex-1 min-w-0 flex flex-col">
          <header className={`h-16 flex-none bg-card border-b border-border flex items-center px-6 gap-4 ${canViewAs ? 'pr-44' : ''}`}>
            <div className="flex-1">
              <HeaderSearch />
            </div>
            <span className="text-sm text-[var(--color-text-secondary)] truncate max-w-[160px]">{me.full_name}</span>
            <LogoutButton />
          </header>

          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>

      {canViewAs && <ViewAsBar />}
    </div>
  )
}
