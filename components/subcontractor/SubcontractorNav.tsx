'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, Briefcase, FileText, Receipt, User, Gavel, CheckSquare, Menu, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Logo from '@/components/ui/Logo'

// `badgeKey` marks a link whose counter is polled from the dashboard endpoint.
// 'revision'  → EMs admin sent back for revision (the UE's own task)
// 'billable'  → there's value ready to invoice (fakturerbart > 0)
type BadgeKey = 'revision' | 'billable'
type NavLink = { href: string; label: string; icon: LucideIcon; exact?: boolean; badgeKey?: BadgeKey }
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
      { href: '/subcontractor/change-orders', label: 'Endringsmeldinger', icon: FileText, badgeKey: 'revision' },
      { href: '/subcontractor/weekly-reports', label: 'Ukesrapporter', icon: CheckSquare },
      { href: '/subcontractor/invoice-basis', label: 'Fakturering', icon: Receipt, badgeKey: 'billable' },
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
  // Sidebar badge counters, polled from the dashboard endpoint.
  const [revisionCount, setRevisionCount] = useState(0)
  const [hasBillable, setHasBillable] = useState(false)

  // Close mobile drawer on navigation + Esc.
  useEffect(() => { setMobileNavOpen(false) }, [pathname])
  useEffect(() => {
    if (!mobileNavOpen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMobileNavOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileNavOpen])

  // Poll the dashboard payload so the sidebar badges stay roughly fresh:
  //  - «Endringsmeldinger» shows the count of EMs sent back for revision (the
  //    UE's own task) from revisionChangeOrders.length.
  //  - «Fakturering» shows a marker when there's value ready to invoice
  //    (kpi.fakturerbart > 0). We only flag presence — never render the amount,
  //    to keep cost figures off the chrome and avoid any price leakage.
  // 30s mirrors the admin sidebar: live enough, cheap on the DB. Runs once on
  // mount, then only on the 30s interval — deliberately NOT keyed on pathname,
  // so rapid navigation doesn't re-fire the full dashboard aggregation per click.
  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const res = await fetch('/api/subcontractor/dashboard')
        if (!res.ok) return
        const data = await res.json() as {
          kpi?: { fakturerbart?: number }
          revisionChangeOrders?: unknown[]
        }
        if (cancelled) return
        setRevisionCount(Array.isArray(data.revisionChangeOrders) ? data.revisionChangeOrders.length : 0)
        setHasBillable((data.kpi?.fakturerbart ?? 0) > 0)
      } catch { /* ignore */ }
    }
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const badgeFor = (key?: BadgeKey): number => {
    if (key === 'revision') return revisionCount
    return 0
  }

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
            {section.links.map(({ href, label, icon: Icon, exact = false, badgeKey }) => {
              const active = exact ? pathname === href : pathname.startsWith(href)
              const count = badgeFor(badgeKey)
              // 'billable' is a presence marker (value ready to invoice), shown
              // as a dot rather than a number — we never render the amount.
              const showBillableDot = badgeKey === 'billable' && hasBillable
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
                  <span className="flex-1">{label}</span>
                  {count > 0 && (
                    <span className="bg-primary text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                      {count}
                    </span>
                  )}
                  {showBillableDot && (
                    <span
                      className="w-2 h-2 rounded-full bg-primary"
                      aria-label="Klart til fakturering"
                    />
                  )}
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
