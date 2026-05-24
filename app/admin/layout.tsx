'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useMe } from '@/lib/useMe'
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
} from 'lucide-react'

const sections = [
  {
    label: 'GENERELT',
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
      { href: '/admin/invoice-basis', label: 'Fakturagrunnlag', icon: Receipt },
    ],
  },
  {
    label: 'VERKTØY',
    links: [
      { href: '/admin/time-types', label: 'Timetyper', icon: Clock },
      { href: '/admin/trash', label: 'Papirkurv', icon: Trash2 },
    ],
  },
  {
    label: 'INNSTILLINGER',
    links: [
      { href: '/admin/users', label: 'Brukere', icon: Users },
      { href: '/admin/access-requests', label: 'Tilgangsforespørsler', icon: UserPlus, badgeKey: 'access-requests' as const },
      { href: '/admin/account', label: 'Min konto', icon: Settings },
    ],
  },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { me, loading, clear } = useMe()
  const [search, setSearch] = useState('')
  const [pendingAccessRequests, setPendingAccessRequests] = useState(0)

  // Role gate. The middleware already requires the session cookie; this
  // catches the case where a logged-in UE user tries to load /admin/* —
  // they get bounced to /login (their portal is elsewhere).
  useEffect(() => {
    if (loading) return
    if (!me || (me.role !== 'project_manager' && me.role !== 'main' && me.role !== 'company')) {
      router.replace('/login')
    }
  }, [loading, me, router])

  const ready = !loading && me !== null

  // Poll the pending-request count so the sidebar badge stays roughly fresh.
  // 30s is frequent enough to feel live but cheap on the DB.
  useEffect(() => {
    if (!ready) return
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
  }, [ready, pathname])

  const badgeFor = (key?: string): number => {
    if (key === 'access-requests') return pendingAccessRequests
    return 0
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    clear()
    // Transitional: older pages still read user_id/role/name from localStorage.
    localStorage.clear()
    router.push('/login')
  }

  if (!ready || !me) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Laster...</div>
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-page)] flex justify-center">
      <div className="w-full max-w-[1600px] flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 flex-none bg-card border-r border-border flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border flex-none">
          <span className="text-lg font-bold text-primary tracking-tight">MinUE</span>
          <span className="text-lg font-light text-[var(--color-text-secondary)] ml-1">Portal</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-4">
          {sections.map((section) => (
            <div key={section.label} className="mb-4">
              <p className="px-5 mb-1 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
                {section.label}
              </p>
              {section.links.map((link) => {
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
          ))}
        </nav>

      </aside>

      {/* Main area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 flex-none bg-card border-b border-border flex items-center px-6 gap-4">
          <div className="flex-1">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (search.trim()) {
                  router.push(`/admin/search?q=${encodeURIComponent(search.trim())}`)
                }
              }}
            >
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Søk i prosjekter, UE, rapporter..."
                className="w-72 px-3 py-1.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
              />
            </form>
          </div>
          <span className="text-sm text-[var(--color-text-secondary)]">{me.full_name}</span>
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
