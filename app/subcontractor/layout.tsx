'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, Briefcase, FileText, Receipt, User, Menu, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMe } from '@/lib/useMe'
import MobileQuickActions from '@/components/subcontractor/MobileQuickActions'

type NavLink = { href: string; label: string; icon: LucideIcon; exact?: boolean }
type NavSection = { label: string; links: NavLink[] }

const sections: NavSection[] = [
  {
    label: 'GENERELT',
    links: [
      { href: '/subcontractor', label: 'Dashbord', icon: LayoutDashboard, exact: true },
      { href: '/subcontractor/projects', label: 'Prosjekter', icon: Briefcase },
    ],
  },
  {
    label: 'MITT ARBEID',
    links: [
      { href: '/subcontractor/change-orders', label: 'Endringsmeldinger', icon: FileText },
      { href: '/subcontractor/invoice-basis', label: 'Fakturagrunnlag', icon: Receipt },
    ],
  },
  {
    label: 'INNSTILLINGER',
    links: [
      { href: '/subcontractor/account', label: 'Min konto', icon: User },
    ],
  },
]

export default function SubcontractorLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { me, loading, clear } = useMe()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Close mobile drawer on navigation + Esc.
  useEffect(() => { setMobileNavOpen(false) }, [pathname])
  useEffect(() => {
    if (!mobileNavOpen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMobileNavOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileNavOpen])

  // Server-side middleware already gates /subcontractor on cookie presence.
  // Role-level check: bounce non-subs back to their appropriate portal.
  // (When the super-admin "views as sub" their effective role is 'sub' so
  // they land here normally; clearing view-as sends them back to /admin.)
  useEffect(() => {
    if (loading) return
    if (!me) { router.replace('/login'); return }
    if (me.role === 'sub') return
    if (me.role === 'company') { router.replace('/company'); return }
    if (me.role === 'main' || me.role === 'project_manager') { router.replace('/admin'); return }
    router.replace('/login')
  }, [loading, me, router])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    clear()
    // Keep localStorage.clear() during transition — older pages still read
    // from it. Remove once all reads are off localStorage.
    localStorage.clear()
    router.push('/login')
  }

  if (loading || !me) {
    return <div className="min-h-screen flex items-center justify-center text-[var(--color-text-muted)]">Laster...</div>
  }
  const userName = me.full_name

  // Shared nav body (desktop sidebar + mobile drawer).
  const navContent = (
    <>
      <div className="h-16 flex items-center px-6 border-b border-border flex-none justify-between">
        <div>
          <span className="text-lg font-bold text-primary tracking-tight">MinUE</span>
          <span className="text-lg font-light text-[var(--color-text-secondary)] ml-1">Portal</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="md:hidden p-1 -mr-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          aria-label="Lukk meny"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        {sections.map((section) => (
          <div key={section.label} className="mb-4">
            <p className="px-5 mb-1 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
              {section.label}
            </p>
            {section.links.map(({ href, label, icon: Icon, exact = false }) => {
              const active = exact ? pathname === href : pathname.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 px-5 py-2 mx-2 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary-soft text-primary'
                      : 'text-[var(--color-text-secondary)] hover:bg-muted hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  <Icon size={16} strokeWidth={1.75} />
                  {label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
    </>
  )

  return (
    <div className="min-h-screen bg-[var(--color-bg-page)] flex justify-center">
      <div className="w-full max-w-[1600px] flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-64 flex-none bg-card border-r border-border flex-col">
          {navContent}
        </aside>

        {/* Mobile drawer */}
        {mobileNavOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 bg-black/40 z-40"
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />
            <aside className="md:hidden fixed inset-y-0 left-0 w-72 z-50 bg-card border-r border-border flex flex-col shadow-xl">
              {navContent}
            </aside>
          </>
        )}

        {/* Floating hamburger — bottom-left, mobile only. Has slightly larger
            bottom-offset (bottom-20) so it sits ABOVE the quick-action bar. */}
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="md:hidden fixed bottom-20 left-4 z-30 bg-card border border-border rounded-full p-3 shadow-lg text-[var(--color-text-primary)] hover:bg-muted"
          aria-label="Åpne meny"
        >
          <Menu size={20} />
        </button>

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="h-16 flex-none bg-card border-b border-border flex items-center px-4 sm:px-6 gap-4">
            <div className="flex-1" />
            <span className="text-sm text-[var(--color-text-secondary)] truncate max-w-[140px] sm:max-w-none">{userName}</span>
            <button
              onClick={handleLogout}
              className="text-xs text-[var(--color-text-muted)] hover:text-danger transition-colors"
            >
              Logg ut
            </button>
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
