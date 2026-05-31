'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Package,
  CheckSquare,
  FileText,
  Clock,
  Trash2,
  Settings,
  TrendingUp,
  BarChart2,
  Receipt,
  UserPlus,
  PieChart,
  ClipboardList,
  Menu,
  X,
} from 'lucide-react'

const sections = [
  {
    label: 'OVERSIKT',
    links: [
      { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { href: '/admin/projects', label: 'Prosjekter', icon: FolderKanban },
      { href: '/admin/subcontractors', label: 'Underentreprenører', icon: Users },
      { href: '/admin/products', label: 'Produkter', icon: Package },
    ],
  },
  {
    label: 'GODKJENNINGER',
    links: [
      { href: '/admin/weekly-reports', label: 'Ukesrapporter', icon: CheckSquare },
      { href: '/admin/change-orders', label: 'Endringsmeldinger', icon: FileText },
    ],
  },
  {
    label: 'PROGNOSER',
    links: [
      { href: '/admin/forecasts', label: 'Oversikt', icon: TrendingUp, exact: true },
      { href: '/admin/forecasts/p1', label: 'P1', icon: BarChart2 },
      { href: '/admin/forecasts/p2', label: 'P2', icon: BarChart2 },
      { href: '/admin/forecasts/p3', label: 'P3', icon: BarChart2 },
      { href: '/admin/forecasts/p4', label: 'P4', icon: BarChart2 },
    ],
  },
  {
    label: 'ØKONOMI',
    links: [
      { href: '/admin/totalokonomi', label: 'Totaløkonomi', icon: PieChart },
      { href: '/admin/invoice-basis', label: 'Fakturagrunnlag', icon: Receipt },
    ],
  },
  {
    label: 'INNSTILLINGER',
    // 'Brukere' and 'Tilgangsforespørsler' are admin-only — gated by the
    // userAdminOnly flag below. Min konto is for everyone.
    links: [
      { href: '/admin/users', label: 'Brukere', icon: Users, userAdminOnly: true as const },
      { href: '/admin/access-requests', label: 'Tilgangsforespørsler', icon: UserPlus, badgeKey: 'access-requests' as const, userAdminOnly: true as const },
      { href: '/admin/account', label: 'Min konto', icon: Settings },
    ],
  },
  {
    // Catch-all for admin/system-level config tables. Sits at the bottom
    // because these are "set once, look at rarely" pages, not daily work.
    label: 'GENERELT',
    links: [
      { href: '/admin/project-types', label: 'Type prosjekt', icon: ClipboardList, userAdminOnly: true as const },
      { href: '/admin/time-types', label: 'Timetyper', icon: Clock, userAdminOnly: true as const },
      { href: '/admin/trash', label: 'Papirkurv', icon: Trash2, userAdminOnly: true as const },
    ],
  },
]

/**
 * Admin sidebar + mobile drawer, extracted as a client island so the layout
 * itself can be a server component. Owns the drawer open/close state (so the
 * hamburger and the drawer can share it), the active-link highlighting
 * (usePathname) and the access-request badge poll.
 *
 * `isUserAdmin` is resolved server-side and passed in — it drives both which
 * links are visible AND whether we poll the access-requests endpoint (PMs have
 * neither the menu item nor permission, so polling would just spam 403s).
 */
export default function AdminSidebarNav({ isUserAdmin }: { isUserAdmin: boolean }) {
  const pathname = usePathname()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [pendingAccessRequests, setPendingAccessRequests] = useState(0)

  // Close mobile drawer on every navigation — otherwise it stays open over
  // the new page and the user has to dismiss it manually.
  useEffect(() => { setMobileNavOpen(false) }, [pathname])

  // Esc closes drawer.
  useEffect(() => {
    if (!mobileNavOpen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMobileNavOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileNavOpen])

  // Poll the pending-request count so the sidebar badge stays roughly fresh.
  // 30s is frequent enough to feel live but cheap on the DB. Skip for PMs —
  // they don't see the menu item OR have permission to call /api/access-
  // requests; polling would just spam 403s.
  useEffect(() => {
    if (!isUserAdmin) return
    let cancelled = false
    async function refresh() {
      try {
        const res = await fetch('/api/access-requests?status=pending')
        if (!res.ok) return
        const list = await res.json() as unknown[]
        if (!cancelled) setPendingAccessRequests(Array.isArray(list) ? list.length : 0)
      } catch { /* ignore */ }
    }
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [isUserAdmin, pathname])

  const badgeFor = (key?: string): number => {
    if (key === 'access-requests') return pendingAccessRequests
    return 0
  }

  // Nav body shared by desktop sidebar AND mobile drawer.
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
        {sections.map((section) => {
          const visibleLinks = section.links.filter((link) =>
            !('userAdminOnly' in link && link.userAdminOnly) || isUserAdmin,
          )
          if (visibleLinks.length === 0) return null
          return (
            <div key={section.label} className="mb-4">
              <p className="px-5 mb-1 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
                {section.label}
              </p>
              {visibleLinks.map((link) => {
                const { href, label, icon: Icon } = link
                const exact = 'exact' in link ? link.exact : false
                const badgeKey = 'badgeKey' in link ? link.badgeKey : undefined
                const active = exact ? pathname === href : pathname.startsWith(href)
                const count = badgeFor(badgeKey)
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
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>
    </>
  )

  return (
    <>
      {/* Desktop sidebar — hidden under md breakpoint. */}
      <aside className="hidden md:flex w-64 flex-none bg-card border-r border-border flex-col">
        {navContent}
      </aside>

      {/* Mobile drawer + backdrop. */}
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

      {/* Floating hamburger — bottom-left on mobile only. Sits ABOVE most
          floating UI but BELOW the drawer overlay. */}
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="md:hidden fixed bottom-4 left-4 z-30 bg-card border border-border rounded-full p-3 shadow-lg text-[var(--color-text-primary)] hover:bg-muted"
        aria-label="Åpne meny"
      >
        <Menu size={20} />
      </button>
    </>
  )
}
