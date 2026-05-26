'use client'

import Link from 'next/link'

function fmt(n: number) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(n)
}

export interface ActiveProjectRow {
  id: string
  name: string
  revenue: number
  progressPct: number // 0-100
}

interface Props {
  projects: ActiveProjectRow[]
  limit?: number
}

/**
 * Compact list of active projects with revenue + progress bar. Shows up to
 * `limit` rows (default 5) sorted by revenue desc, with a "Se alle"-link
 * to the full /admin/projects table.
 */
export default function ActiveProjectsList({ projects, limit = 5 }: Props) {
  const sorted = [...projects].sort((a, b) => b.revenue - a.revenue).slice(0, limit)
  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Aktive prosjekter</h2>
        <Link href="/admin/projects" className="text-xs text-primary hover:underline font-medium">
          Se alle
        </Link>
      </div>
      {sorted.length === 0 ? (
        <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
          Ingen aktive prosjekter ennå
        </div>
      ) : (
        <div className="divide-y divide-border">
          {sorted.map((p) => (
            <Link
              key={p.id}
              href={`/admin/projects/${p.id}`}
              className="block px-5 py-3 hover:bg-muted transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                  {p.name}
                </p>
                <div className="text-right flex-none">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{fmt(p.revenue)}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">Omsetning</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${Math.max(0, Math.min(100, p.progressPct))}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--color-text-muted)] flex-none">{Math.round(p.progressPct)}%</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
