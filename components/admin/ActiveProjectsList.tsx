'use client'

import Link from 'next/link'

function fmt(n: number) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(n)
}

export interface ActiveProjectRow {
  id: string
  name: string
  actualRevenue: number
  plannedRevenue: number
  actualCost: number
  plannedCost: number
}

interface Props {
  projects: ActiveProjectRow[]
  limit?: number
}

interface BarPairProps {
  label: string
  actual: number
  planned: number
  /** Tailwind classes for the fill color of the actual segment. */
  actualFill: string
  /** When actual > planned, render this color past the planned mark to flag overrun. */
  overFill: string
}

/**
 * Renders a single planned-vs-actual horizontal bar:
 *   - Track width is the larger of (planned, actual) so an overrun is visible
 *   - "Actual" segment fills from 0 to actual (clamped to track)
 *   - "Planned" tick is rendered as a dashed marker at planned/track%
 *   - When actual > planned, the overflow shows in overFill color
 */
function BarPair({ label, actual, planned, actualFill, overFill }: BarPairProps) {
  const trackMax = Math.max(actual, planned, 1) // never divide by 0
  const actualPct = (Math.min(actual, planned) / trackMax) * 100
  const overflowPct = actual > planned ? ((actual - planned) / trackMax) * 100 : 0
  const plannedPct = (planned / trackMax) * 100
  const used = planned > 0 ? Math.round((actual / planned) * 100) : 0
  const overrun = actual > planned

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-[var(--color-text-secondary)]">{label}</span>
        <span className={`tabular-nums ${overrun ? 'text-red-600 font-semibold' : 'text-[var(--color-text-muted)]'}`}>
          {fmt(actual)} <span className="text-[var(--color-text-muted)]">/ {fmt(planned)}</span>
          <span className="ml-1.5 text-[var(--color-text-muted)]">({used}%)</span>
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
        {/* Actual fill (clamped to planned) */}
        {actualPct > 0 && (
          <div className={`absolute inset-y-0 left-0 ${actualFill}`} style={{ width: `${actualPct}%` }} />
        )}
        {/* Overflow segment (only if actual > planned) */}
        {overflowPct > 0 && (
          <div className={`absolute inset-y-0 ${overFill}`} style={{ left: `${actualPct}%`, width: `${overflowPct}%` }} />
        )}
        {/* Planned marker — a slim vertical line, suppressed when planned ≥ track (== 100%) */}
        {planned > 0 && plannedPct < 100 && (
          <div
            className="absolute inset-y-0 w-0.5 bg-[var(--color-text-secondary)]/70"
            style={{ left: `${plannedPct}%` }}
            title={`Budsjettert: ${fmt(planned)}`}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Compact list of active projects on /admin/totalokonomi. Each project gets
 * two planned-vs-actual bar pairs: Omsetning (revenue actual vs budget) and
 * Kostnad (UE-cost actual vs budget). Cost overruns flag in red.
 */
export default function ActiveProjectsList({ projects, limit = 5 }: Props) {
  const sorted = [...projects].sort((a, b) => b.plannedRevenue - a.plannedRevenue).slice(0, limit)
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
        <ul className="divide-y divide-border">
          {sorted.map((p) => (
            <li key={p.id}>
              <Link
                href={`/admin/projects/${p.id}`}
                className="block px-5 py-4 hover:bg-muted transition-colors space-y-2.5"
              >
                <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{p.name}</p>
                <BarPair
                  label="Omsetning"
                  actual={p.actualRevenue}
                  planned={p.plannedRevenue}
                  actualFill="bg-primary"
                  overFill="bg-blue-300"
                />
                <BarPair
                  label="UE-kostnad"
                  actual={p.actualCost}
                  planned={p.plannedCost}
                  actualFill="bg-amber-500"
                  overFill="bg-red-500"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
