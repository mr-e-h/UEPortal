'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
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
      { href: '/admin/account', label: 'Min konto', icon: Settings },
    ],
  },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [userName, setUserName] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const role = localStorage.getItem('user_role')
    if (role !== 'project_manager' && role !== 'main' && role !== 'company') {
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
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Laster...</div>
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-page)] flex justify-center">
      <div className="w-full max-w-[1600px] flex min-h-screen">
      {/* Sidebar */}
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
              {section.links.map(({ href, label, icon: Icon, exact }) => {
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
