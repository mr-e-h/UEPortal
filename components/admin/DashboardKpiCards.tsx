'use client'

import { useState } from 'react'
import Link from 'next/link'

export interface ProjectBreakdown {
  id: string
  name: string
  revenue: number
  cost: number
  internalCost: number
  profit: number
  // Planned-vs-actual fields for the Aktive prosjekter bars on
  // /admin/totalokonomi. Planned values come from project_budget_lines
  // (budget_quantity × the respective price snapshot); actual revenue/cost
  // are the same numbers as `revenue` / `cost` above but pulled out for
  // semantic clarity at the call site.
  plannedRevenue: number
  plannedCost: number
  /** Fakturert hittil i år (Σ project_invoices.amount i inneværende år). */
  invoiced: number
}

function fmt(n: number) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(n)
}

interface KpiProps {
  label: string
  value: string
  sub: string
  active?: boolean
  onClick?: () => void
  valueClass?: string
}

function Kpi({ label, value, sub, active, onClick, valueClass }: KpiProps) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`w-full text-left rounded-xl border bg-card p-5 shadow-sm transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md' : ''
      } ${active ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)] truncate">{label}</p>
      <p className={`text-2xl font-bold mt-1.5 ${valueClass ?? 'text-[var(--color-text-primary)]'}`}>{value}</p>
      <p className="text-xs mt-1 text-[var(--color-text-muted)]">{sub}</p>
    </Tag>
  )
}

interface Props {
  yearRevenue: number
  yearCost: number
  yearInternalCost: number
  yearProfit: number
  profitMargin: number
  pendingReports: number
  pendingCOCount: number
  pendingCOValue: number
  pendingCOCost: number
  submittedThisWeek: number
  currentWeek: number
  thisYear: number
  projectBreakdowns: ProjectBreakdown[]
}

export default function DashboardKpiCards({
  yearRevenue, yearCost, yearInternalCost, yearProfit, profitMargin,
  pendingReports, pendingCOCount, pendingCOValue, pendingCOCost,
  submittedThisWeek, currentWeek, thisYear, projectBreakdowns,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const toggle = (key: string) => setExpanded((p) => (p === key ? null : key))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Kpi
          label={`Omsetning ${thisYear}`}
          value={fmt(yearRevenue)}
          sub="Klikk for fordeling ↓"
          active={expanded === 'revenue'}
          onClick={() => toggle('revenue')}
        />
        <Kpi
          label={`UE-kostnad ${thisYear}`}
          value={fmt(yearCost)}
          sub="Klikk for fordeling ↓"
          active={expanded === 'cost'}
          onClick={() => toggle('cost')}
        />
        <Kpi
          label={`Internkostnad ${thisYear}`}
          value={fmt(yearInternalCost)}
          sub="Egne timer"
        />
        <Kpi
          label={`Fortjeneste ${thisYear}`}
          value={fmt(yearProfit)}
          sub={`Margin ${profitMargin}%`}
          active={expanded === 'profit'}
          onClick={() => toggle('profit')}
          valueClass={yearProfit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}
        />
        <Kpi
          label="Rapporter til godkjenning"
          value={String(pendingReports)}
          sub={`${submittedThisWeek} innsendt uke ${currentWeek}`}
        />
        <Kpi
          label="EM til godkjenning"
          value={String(pendingCOCount)}
          sub={pendingCOCount > 0 ? `${fmt(pendingCOValue)} total verdi` : 'Ingen ventende'}
          active={expanded === 'em'}
          onClick={pendingCOCount > 0 ? () => toggle('em') : undefined}
          valueClass={pendingCOCount > 0 ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-primary)]'}
        />
      </div>

      {expanded && (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-muted/40">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {expanded === 'revenue' && 'Omsetning per prosjekt'}
              {expanded === 'cost' && 'UE-kostnad per prosjekt'}
              {expanded === 'profit' && 'Fortjeneste per prosjekt'}
              {expanded === 'em' && 'Ventende endringsmeldinger'}
            </h3>
            <button
              onClick={() => setExpanded(null)}
              className="text-xs text-[var(--color-text-muted)] hover:text-primary px-2 py-1 rounded hover:bg-muted"
            >
              ✕ Lukk
            </button>
          </div>

          {(expanded === 'revenue' || expanded === 'cost' || expanded === 'profit') && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Prosjekt', 'Omsetning', 'UE-kostnad', 'Internkostnad', 'Fortjeneste', ''].map((h) => (
                      <th
                        key={h}
                        className={`px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide ${
                          h && h !== 'Prosjekt' && h !== '' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {projectBreakdowns.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">
                        Ingen godkjente rapporter ennå
                      </td>
                    </tr>
                  )}
                  {projectBreakdowns.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-[var(--color-text-primary)]">
                        <Link href={`/admin/projects/${p.id}`} className="hover:text-primary hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-right text-[var(--color-text-secondary)]">{fmt(p.revenue)}</td>
                      <td className="px-5 py-3 text-right text-[var(--color-text-secondary)]">{fmt(p.cost)}</td>
                      <td className="px-5 py-3 text-right text-[var(--color-text-secondary)]">{fmt(p.internalCost)}</td>
                      <td
                        className={`px-5 py-3 text-right font-semibold ${
                          p.profit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'
                        }`}
                      >
                        {fmt(p.profit)}
                      </td>
                      <td className="px-5 py-3">
                        <Link href={`/admin/projects/${p.id}`} className="text-xs text-primary hover:underline">
                          Åpne →
                        </Link>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/30">
                    <td className="px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)] uppercase">Totalt</td>
                    <td className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--color-text-primary)]">
                      {fmt(projectBreakdowns.reduce((s, p) => s + p.revenue, 0))}
                    </td>
                    <td className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--color-text-primary)]">
                      {fmt(projectBreakdowns.reduce((s, p) => s + p.cost, 0))}
                    </td>
                    <td className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--color-text-primary)]">
                      {fmt(projectBreakdowns.reduce((s, p) => s + p.internalCost, 0))}
                    </td>
                    <td className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--color-success)]">
                      {fmt(projectBreakdowns.reduce((s, p) => s + p.profit, 0))}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {expanded === 'em' && (
            <div className="px-5 py-5">
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="rounded-lg bg-warning/10 border border-warning/30 p-4 text-center">
                  <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide mb-1">Antall EM</p>
                  <p className="text-2xl font-bold text-[var(--color-warning)]">{pendingCOCount}</p>
                </div>
                <div className="rounded-lg bg-muted border border-border p-4 text-center">
                  <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide mb-1">Total salgsverdi</p>
                  <p className="text-2xl font-bold text-[var(--color-text-primary)]">{fmt(pendingCOValue)}</p>
                </div>
                <div className="rounded-lg bg-muted border border-border p-4 text-center">
                  <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide mb-1">Total kostnad</p>
                  <p className="text-2xl font-bold text-[var(--color-text-primary)]">{fmt(pendingCOCost)}</p>
                </div>
              </div>
              <Link
                href="/admin/change-orders"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline font-medium"
              >
                Se og behandle alle endringsmeldinger →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
