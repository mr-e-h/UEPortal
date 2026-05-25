'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, Users, Mail, Settings, Menu, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMe } from '@/lib/useMe'

type NavLink = { href: string; label: string; icon: LucideIcon; exact?: boolean }
type NavSection = { label: string; links: NavLink[] }

const sections: NavSection[] = [
  {
    label: 'GENERELT',
    links: [
      { href: '/company', label: 'Oversikt', icon: LayoutDashboard, exact: true },
    ],
  },
  {
    label: 'ADMINISTRASJON',
    links: [
      { href: '/company/users', label: 'Brukere', icon: Users },
      { href: '/company/invitations', label: 'Invitasjoner', icon: Mail },
    ],
  },
  {
    label: 'INNSTILLINGER',
    links: [
      { href: '/company/account', label: 'Min konto', icon: Settings },
    ],
  },
]

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { me, loading, clear } = useMe()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => { setMobileNavOpen(false) }, [pathname])
  useEffect(() => {
    if (!mobileNavOpen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMobileNavOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileNavOpen])

  useEffect(() => {
    if (loading) return
    if (!me) { router.replace('/login'); return }
    if (me.role === 'company') return
    if (me.role === 'sub') { router.replace('/subcontractor'); return }
    if (me.role === 'main' || me.role === 'project_manager') { router.replace('/admin'); return }
    router.replace('/login')
  }, [loading, me, router])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    clear()
    localStorage.clear()
    router.push('/login')
  }

  if (loading || !me) {
    return <div className="min-h-screen flex items-center justify-center text-[var(--color-text-muted)]">Laster...</div>
  }
  const userName = me.full_name

  // Shared nav content for desktop sidebar + mobile drawer.
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

      <div className="flex-none border-t border-border p-4">
        <p className="text-xs font-medium text-[var(--color-text-primary)] truncate">{userName}</p>
        <button
          onClick={handleLogout}
          className="text-xs text-[var(--color-text-muted)] hover:text-danger mt-0.5 transition-colors"
        >
          Logg ut
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen flex bg-[var(--color-bg-page)]">
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

      {/* Floating hamburger — bottom-left on mobile only. */}
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="md:hidden fixed bottom-4 left-4 z-30 bg-card border border-border rounded-full p-3 shadow-lg text-[var(--color-text-primary)] hover:bg-muted"
        aria-label="Åpne meny"
      >
        <Menu size={20} />
      </button>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 flex-none bg-card border-b border-border flex items-center px-4 sm:px-6 gap-4">
          <div className="flex-1" />
          <span className="text-sm text-[var(--color-text-secondary)] truncate max-w-[140px] sm:max-w-none">{userName}</span>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
