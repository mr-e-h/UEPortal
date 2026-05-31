import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getEffectiveUser } from '@/lib/view-as'
import SubcontractorNav from '@/components/subcontractor/SubcontractorNav'
import LogoutButton from '@/components/LogoutButton'
import MobileQuickActions from '@/components/subcontractor/MobileQuickActions'

/**
 * Subcontractor shell — server component. Resolves session + view-as on the
 * server so the shell renders in the initial HTML without a client /api/me
 * gate. Role gate mirrors the previous client useEffect: only subs render
 * here; everyone else is routed to their own portal. (Super-admin "view as
 * sub" lands here because the effective role is 'sub'.)
 */
export default async function SubcontractorLayout({ children }: { children: React.ReactNode }) {
  const realUser = await getSession()
  if (!realUser) redirect('/login')
  const me = await getEffectiveUser(realUser)

  if (me.role !== 'sub') {
    if (me.role === 'company') redirect('/company')
    if (me.role === 'main' || me.role === 'project_manager') redirect('/admin')
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-page)] flex justify-center">
      <div className="w-full max-w-[1600px] flex min-h-screen">
        <SubcontractorNav />

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="h-16 flex-none bg-card border-b border-border flex items-center px-4 sm:px-6 gap-4">
            <div className="flex-1" />
            <span className="text-sm text-[var(--color-text-secondary)] truncate max-w-[140px] sm:max-w-none">{me.full_name}</span>
            <LogoutButton />
          </header>

          {/* Extra bottom padding on mobile so the fixed action bar doesn't
              cover the last bit of content. */}
          <main className="flex-1 overflow-auto pb-20 md:pb-0">
            {children}
          </main>
        </div>
      </div>

      <MobileQuickActions />
    </div>
  )
}
