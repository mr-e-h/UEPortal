'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, Briefcase, FileText, Receipt, User, Gavel, Menu, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Logo from '@/components/ui/Logo'

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
      { href: '/subcontractor/tenders', label: 'Tilbud', icon: Gavel },
      { href: '/subcontractor/change-orders', label: 'Endringsmeldinger', icon: FileText },
      { href: '/subcontractor/invoice-basis', label: 'Fakturering', icon: Receipt },
    ],
  },
  {
    label: 'INNSTILLINGER',
    links: [
      { href: '/subcontractor/account', label: 'Min konto', icon: User },
    ],
  },
]

/**
 * Subcontractor sidebar + mobile drawer, extracted as a client island so the
 * layout can be a server component. Owns drawer state (shared by hamburger and
 * drawer) and active-link highlighting. No search or badges here.
 */
export default function SubcontractorNav() {
  const pathname = usePathname()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Close mobile drawer on navigation + Esc.
  useEffect(() => { setMobileNavOpen(false) }, [pathname])
  useEffect(() => {
    if (!mobileNavOpen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMobileNavOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileNavOpen])

  // Shared nav body (desktop sidebar + mobile drawer).
  const navContent = (
    <>
      <div className="h-16 flex items-center px-6 border-b border-border flex-none justify-between">
        <Logo size={26} showPortal />
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
    <>
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
    </>
  )
}
