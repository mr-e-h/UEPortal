'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Card from '@/components/ui/Card'
import type { MonthBucket } from './MonthlyBarChart'

// Lazy-load the recharts bar chart so the charting lib is code-split out of
// the /admin initial bundle and fetched after first paint. ssr:false is safe
// here because this is a client component; the PM filter, header and totals
// render immediately while only the chart canvas streams in afterwards.
const MonthlyBarChart = dynamic(() => import('./MonthlyBarChart'), {
  ssr: false,
  loading: () => <div className="h-[280px] w-full animate-pulse rounded-lg bg-gray-100" />,
})

function fmt(n: number) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(n)
}

interface Props {
  year: number
  /** Totals across the whole portfolio. */
  all: MonthBucket[]
  /** Pre-computed per-PM buckets — key is user_id. */
  byPm: Record<string, MonthBucket[]>
  /** Active PMs available in the dropdown. */
  pmList: Array<{ id: string; name: string }>
}

/**
 * Wraps the monthly bar chart with a project-manager filter. The dropdown
 * is server-rendered with options; the actual rebucketing happens on the
 * server, so changing the filter is a zero-fetch O(1) lookup client-side.
 *
 * Project ↔ PM is many-to-many — a project with two PMs contributes to
 * BOTH PMs' totals when you filter to either. That's intentional so each
 * PM sees their own attributable revenue without us having to invent a
 * weighting scheme.
 */
export default function MonthlyChartWithPmFilter({ year, all, byPm, pmList }: Props) {
  const [selectedPmId, setSelectedPmId] = useState<string>('all')

  const data = useMemo(() => {
    if (selectedPmId === 'all') return all
    return byPm[selectedPmId] ?? all.map((b) => ({ ...b, omsetning: 0, kostnad: 0, fakturert: 0 }))
  }, [selectedPmId, all, byPm])

  // Year total of revenue across the filtered view — small "this PM's
  // year" tag next to the dropdown so the filter feels alive.
  const yearTotalRev = useMemo(
    () => data.reduce((s, b) => s + b.omsetning, 0),
    [data],
  )

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Per måned {year}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="pm-filter" className="text-xs text-[var(--color-text-muted)]">
            Prosjektleder
          </label>
          <select
            id="pm-filter"
            value={selectedPmId}
            onChange={(e) => setSelectedPmId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
          >
            <option value="all">Alle</option>
            {pmList.map((pm) => (
              <option key={pm.id} value={pm.id}>{pm.name}</option>
            ))}
          </select>
          {selectedPmId !== 'all' && (
            <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
              {fmt(yearTotalRev)} omsetning {year}
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--color-text-muted)] mb-3">
        Omsetning · Kostnad · Fakturert
        {selectedPmId !== 'all' && ' — kun prosjekter tildelt valgt PL'}
      </p>
      <MonthlyBarChart data={data} />
    </Card>
  )
}
