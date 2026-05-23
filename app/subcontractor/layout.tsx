'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Briefcase, FileText, Receipt, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMe } from '@/lib/useMe'

type NavLink = { href: string; label: string; icon: LucideIcon; exact?: boolean }
type NavSection = { label: string; links: NavLink[] }

const sections: NavSection[] = [
  {
    label: 'GENERELT',
    links: [
      { href: '/subcontractor', label: 'Mine prosjekter', icon: Briefcase, exact: true },
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

  // Server-side middleware already gates /subcontractor on cookie presence.
  // This is the role-level check: if the logged-in user isn't a UE, kick
  // them back to /login (their dashboard isn't here).
  useEffect(() => {
    if (loading) return
    if (!me || (me.role !== 'subcontractor' && me.role !== 'sub')) {
      router.replace('/login')
    }
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

  return (
    <div className="min-h-screen bg-[var(--color-bg-page)] flex justify-center">
      <div className="w-full max-w-[1600px] flex min-h-screen">
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
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="h-16 flex-none bg-card border-b border-border flex items-center px-6 gap-4">
            <div className="flex-1" />
            <span className="text-sm text-[var(--color-text-secondary)]">{userName}</span>
            <button
              onClick={handleLogout}
              className="text-xs text-[var(--color-text-muted)] hover:text-danger transition-colors"
            >
              Logg ut
            </button>
          </header>

          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
