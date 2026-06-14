'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { fmtNOK } from '@/lib/format'

export interface ProjectEconomyRow {
  id: string
  name: string
  actualRevenue: number
  plannedRevenue: number
  /** Actual UE-cost (approved weekly-report lines + approved EMs). */
  actualCost: number
  /** Budgeted UE-cost from project_budget_lines. */
  plannedCost: number
  /** Actual internal cost (sum of approved hour-entry rows × rate). */
  actualInternalCost: number
  /** Fakturert hittil i år (Σ project_invoices.amount i inneværende år). */
  invoiced: number
}

type SortKey = 'name' | 'revenue' | 'invoiced' | 'cost' | 'profit' | 'margin'

/** Avledede tall per prosjekt — kostnad = UE + intern, fortjeneste = oms − kost. */
function derive(r: ProjectEconomyRow) {
  const cost = r.actualCost + r.actualInternalCost
  const profit = r.actualRevenue - cost
  const margin = r.actualRevenue > 0 ? profit / r.actualRevenue : 0
  // Leveringsgrad: hvor mye av budsjettert omsetning som er fakturert/godkjent.
  const delivered = r.plannedRevenue > 0 ? r.actualRevenue / r.plannedRevenue : 0
  return { cost, profit, margin, delivered }
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`
}

/**
 * Prosjektøkonomi som én skannbar tabell i stedet for stablede søyler per
 * prosjekt. Én rad = ett prosjekt, kolonner for omsetning, kostnad, fortjeneste
 * og margin slik at man kan sammenligne på tvers. En tynn linje under navnet
 * viser leveringsgrad mot budsjettert omsetning. Bunnrad summerer alt.
 *
 * All kundeøkonomi — rendres kun på Totaløkonomi (ADMIN_ROLES), aldri byggeleder.
 */
export default function ProjectEconomyTable({ projects }: { projects: ProjectEconomyRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(() => {
    const valueOf = (r: ProjectEconomyRow): number | string => {
      const d = derive(r)
      switch (sortKey) {
        case 'name': return r.name.toLowerCase()
        case 'revenue': return r.actualRevenue
        case 'invoiced': return r.invoiced
        case 'cost': return d.cost
        case 'profit': return d.profit
        case 'margin': return d.margin
      }
    }
    return [...projects].sort((a, b) => {
      const va = valueOf(a), vb = valueOf(b)
      const cmp = typeof va === 'string' && typeof vb === 'string'
        ? va.localeCompare(vb, 'nb')
        : (va as number) - (vb as number)
      return dir === 'asc' ? cmp : -cmp
    })
  }, [projects, sortKey, dir])

  const totals = useMemo(() => {
    return projects.reduce(
      (acc, r) => {
        const d = derive(r)
        acc.revenue += r.actualRevenue
        acc.invoiced += r.invoiced
        acc.cost += d.cost
        acc.profit += d.profit
        return acc
      },
      { revenue: 0, invoiced: 0, cost: 0, profit: 0 },
    )
  }, [projects])
  const totalMargin = totals.revenue > 0 ? totals.profit / totals.revenue : 0

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Tekst sorteres stigende først, tall synkende først (størst øverst).
      setDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const numHeads: { key: SortKey; label: string }[] = [
    { key: 'revenue', label: 'Omsetning' },
    { key: 'invoiced', label: 'Fakturert' },
    { key: 'cost', label: 'Kostnad' },
    { key: 'profit', label: 'Fortjeneste' },
    { key: 'margin', label: 'Margin' },
  ]

  function SortIcon({ active }: { active: boolean }) {
    if (!active) return null
    return dir === 'asc'
      ? <ChevronUp size={12} className="inline-block ml-0.5 -mt-0.5" />
      : <ChevronDown size={12} className="inline-block ml-0.5 -mt-0.5" />
  }

  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Aktive prosjekter</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Godkjent omsetning, kostnad og fortjeneste hittil i år</p>
        </div>
        <Link href="/admin/projects" className="text-xs text-primary hover:underline font-medium flex-none">
          Se alle
        </Link>
      </div>

      {sorted.length === 0 ? (
        <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
          Ingen aktive prosjekter ennå
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)] border-b border-border">
                <th className="text-left font-medium px-5 py-2.5">
                  <button type="button" onClick={() => toggleSort('name')} className="hover:text-[var(--color-text-secondary)]">
                    Prosjekt<SortIcon active={sortKey === 'name'} />
                  </button>
                </th>
                {numHeads.map((h) => (
                  <th key={h.key} className="text-right font-medium px-5 py-2.5 whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort(h.key)} className="hover:text-[var(--color-text-secondary)]">
                      {h.label}<SortIcon active={sortKey === h.key} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((r) => {
                const d = derive(r)
                const profitPositive = d.profit >= 0
                return (
                  <tr key={r.id} className="hover:bg-muted/60 transition-colors">
                    <td className="px-5 py-2 max-w-0 w-[34%]">
                      <Link
                        href={`/admin/projects/${r.id}`}
                        className="font-medium text-[var(--color-text-primary)] hover:text-primary truncate block"
                        title={r.plannedRevenue > 0 ? `${pct(d.delivered)} av budsjettert omsetning levert` : undefined}
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-[var(--color-text-primary)] whitespace-nowrap">{fmtNOK(r.actualRevenue)}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-[var(--color-text-secondary)] whitespace-nowrap" title={r.actualRevenue > 0 ? `${pct(r.invoiced / r.actualRevenue)} av omsetning` : undefined}>{fmtNOK(r.invoiced)}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-[var(--color-text-secondary)] whitespace-nowrap" title={`UE: ${fmtNOK(r.actualCost)} · Intern: ${fmtNOK(r.actualInternalCost)}`}>{fmtNOK(d.cost)}</td>
                    <td className={`px-5 py-3 text-right tabular-nums font-medium whitespace-nowrap ${profitPositive ? 'text-green-700' : 'text-red-600'}`}>{fmtNOK(d.profit)}</td>
                    <td className={`px-5 py-3 text-right tabular-nums whitespace-nowrap ${profitPositive ? 'text-[var(--color-text-secondary)]' : 'text-red-600'}`}>{r.actualRevenue > 0 ? pct(d.margin) : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/40 font-semibold text-[var(--color-text-primary)]">
                <td className="px-5 py-2">Totalt ({sorted.length})</td>
                <td className="px-5 py-3 text-right tabular-nums whitespace-nowrap">{fmtNOK(totals.revenue)}</td>
                <td className="px-5 py-3 text-right tabular-nums whitespace-nowrap">{fmtNOK(totals.invoiced)}</td>
                <td className="px-5 py-3 text-right tabular-nums whitespace-nowrap">{fmtNOK(totals.cost)}</td>
                <td className={`px-5 py-3 text-right tabular-nums whitespace-nowrap ${totals.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtNOK(totals.profit)}</td>
                <td className={`px-5 py-3 text-right tabular-nums whitespace-nowrap ${totals.profit >= 0 ? '' : 'text-red-600'}`}>{totals.revenue > 0 ? pct(totalMargin) : '–'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
