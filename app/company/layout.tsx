'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, Users, Mail, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

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
  const [ready, setReady] = useState(false)
  const [userName, setUserName] = useState('')

  useEffect(() => {
    if (localStorage.getItem('user_role') !== 'company') {
      router.replace('/login')
    } else {
      setUserName(localStorage.getItem('user_name') ?? '')
      setReady(true)
    }
  }, [router])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    localStorage.clear()
    router.push('/login')
  }

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-[var(--color-text-muted)]">Laster...</div>
  }

  return (
    <div className="min-h-screen flex bg-[var(--color-bg-page)]">
      <aside className="w-64 flex-none bg-card border-r border-border flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border flex-none">
          <span className="text-lg font-bold text-primary tracking-tight">Netel</span>
          <span className="text-lg font-light text-[var(--color-text-secondary)] ml-1">Portal</span>
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
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 flex-none bg-card border-b border-border flex items-center px-6 gap-4">
          <div className="flex-1" />
          <span className="text-sm text-[var(--color-text-secondary)]">{userName}</span>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
