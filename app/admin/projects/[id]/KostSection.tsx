'use client'

import { fmtNOK as fmt } from '@/lib/format'

interface Props {
  totalSales: number
  totalCost: number
  totalInternalCost: number
}

/**
 * Dedicated Kost tab. The Prosjektstatistikk top KPIs that used to live
 * at the top of Oversikt were moved here so Oversikt could shrink to the
 * "who/what/when" overhead info. Numbers still come from the same source
 * (computed in the parent), so the two tabs always show identical totals.
 */
export default function KostSection({ totalSales, totalCost, totalInternalCost }: Props) {
  const profit = totalSales - totalCost - totalInternalCost
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3">Prosjektstatistikk</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-blue-600 rounded-xl shadow p-4 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Salgsverdi</p>
            <p className="text-2xl font-bold mt-1">{fmt(totalSales)}</p>
            <p className="text-xs opacity-70 mt-0.5">inkl. godkjente EM</p>
          </div>
          <div className="bg-white rounded-xl shadow p-4 border border-border">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">UE-kostnad</p>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{fmt(totalCost)}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">tildelte budsjettlinjer</p>
          </div>
          <div className="bg-white rounded-xl shadow p-4 border border-border">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Internkostnad</p>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{fmt(totalInternalCost)}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">egne timer</p>
          </div>
          <div className={`rounded-xl shadow p-4 border ${profit >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Reell fortjeneste</p>
            <p className={`text-2xl font-bold mt-1 ${profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(profit)}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">salg − UE − intern</p>
          </div>
        </div>
      </section>
    </div>
  )
}
