'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import DashboardChart from './DashboardChart'
import DashboardKpiCards from './DashboardKpiCards'
import PendingTable from './PendingTable'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import type { WeekPoint } from './DashboardChart'
import type { PendingRow } from './PendingTable'
import type { ProjectBreakdown } from './DashboardKpiCards'
import type { ProjectStatus } from '@/types'

type PeriodKey = '4w' | '12w' | 'ytd'

export type PendingCORow = {
  id: string
  project_name: string
  sub_name: string
  reason: string
  total_customer_value: number
  total_cost: number
  submitted_at: string | null
}

export type ProjectStat = {
  id: string
  name: string
  project_number: string
  customer: string
  county: string
  status: ProjectStatus
  revenue: number
  cost: number
}

const PERIOD_LABELS: Record<PeriodKey, string> = {
  '4w': '4 uker',
  '12w': '12 uker',
  'ytd': 'I år',
}

function fmt(n: number) {
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency: 'NOK',
    maximumFractionDigits: 0,
  }).format(n)
}

type Props = {
  chartData: Record<PeriodKey, WeekPoint[]>
  projectStats: Record<PeriodKey, ProjectStat[]>
  pendingCORows: PendingCORow[]
  pendingReportRows: PendingRow[]
  yearRevenue: number
  yearCost: number
  yearInternalCost: number
  yearProfit: number
  profitMargin: number
  pendingCOCount: number
  pendingCOValue: number
  pendingCOCost: number
  submittedThisWeek: number
  currentWeek: number
  thisYear: number
  projectBreakdowns: ProjectBreakdown[]
}

export default function DashboardClient({
  chartData,
  projectStats,
  pendingCORows,
  pendingReportRows,
  yearRevenue,
  yearCost,
  yearInternalCost,
  yearProfit,
  profitMargin,
  pendingCOCount,
  pendingCOValue,
  pendingCOCost,
  submittedThisWeek,
  currentWeek,
  thisYear,
  projectBreakdowns,
}: Props) {
  const [period, setPeriod] = useState<PeriodKey>('12w')
  const router = useRouter()

  const stats = projectStats[period]
  const chartPoints = chartData[period]

  return (
    <div className="p-6 space-y-6">
      <DashboardKpiCards
        yearRevenue={yearRevenue}
        yearCost={yearCost}
        yearInternalCost={yearInternalCost}
        yearProfit={yearProfit}
        profitMargin={profitMargin}
        pendingReports={pendingReportRows.length}
        pendingCOCount={pendingCOCount}
        pendingCOValue={pendingCOValue}
        pendingCOCost={pendingCOCost}
        submittedThisWeek={submittedThisWeek}
        currentWeek={currentWeek}
        thisYear={thisYear}
        projectBreakdowns={projectBreakdowns}
      />

      {/* Full-width chart with period filter */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Omsetning</h2>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setPeriod(k)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                  period === k
                    ? 'bg-white text-[var(--color-text-primary)] shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {PERIOD_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <DashboardChart data={chartPoints} />
      </Card>

      {/* Pending approvals — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending change orders */}
        <Card>
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Endringsmeldinger til godkjenning
            </h2>
            {pendingCORows.length > 0 && (
              <span className="bg-primary text-white text-xs font-medium px-1.5 py-0.5 rounded-full">
                {pendingCORows.length}
              </span>
            )}
          </div>
          {pendingCORows.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
              Ingen endringsmeldinger venter godkjenning
            </div>
          ) : (
            <div className="divide-y divide-border">
              {pendingCORows.map((co) => (
                <Link
                  key={co.id}
                  href={`/admin/change-orders/${co.id}`}
                  className="flex items-start justify-between gap-3 px-6 py-3 hover:bg-muted transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {co.project_name}
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)] truncate">{co.sub_name}</p>
                    {co.reason && (
                      <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{co.reason}</p>
                    )}
                  </div>
                  <div className="text-right flex-none">
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {fmt(co.total_customer_value)}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">{co.submitted_at ?? '–'}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Pending weekly reports */}
        <Card>
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Ukesrapporter til godkjenning
            </h2>
            {pendingReportRows.length > 0 && (
              <span className="bg-primary text-white text-xs font-medium px-1.5 py-0.5 rounded-full">
                {pendingReportRows.length}
              </span>
            )}
          </div>
          <PendingTable rows={pendingReportRows} />
        </Card>
      </div>

      {/* Projects table with period revenue/cost */}
      <Card>
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Prosjekter
            <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
              ({PERIOD_LABELS[period]})
            </span>
          </h2>
          <Button href="/admin/projects/new" variant="primary" className="px-3 py-1.5 text-xs">
            + Nytt prosjekt
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {[
                  { label: 'Prosjektnavn', right: false },
                  { label: 'Nummer', right: false },
                  { label: 'Kunde', right: false },
                  { label: 'Fylke', right: false },
                  { label: 'Status', right: false },
                  { label: 'Omsetning', right: true },
                  { label: 'UE-kostnad', right: true },
                ].map(({ label, right }) => (
                  <th
                    key={label}
                    className={`px-6 py-3 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide ${
                      right ? 'text-right' : 'text-left'
                    }`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/admin/projects/${p.id}`)}
                  className="border-b border-border last:border-0 hover:bg-muted transition-colors cursor-pointer"
                >
                  <td className="px-6 py-3 font-medium text-[var(--color-text-primary)]">{p.name}</td>
                  <td className="px-6 py-3 text-[var(--color-text-secondary)]">{p.project_number}</td>
                  <td className="px-6 py-3 text-[var(--color-text-secondary)]">{p.customer}</td>
                  <td className="px-6 py-3 text-[var(--color-text-secondary)]">{p.county}</td>
                  <td className="px-6 py-3">
                    <Badge status={p.status === 'active' ? 'active' : 'draft'} />
                  </td>
                  <td className="px-6 py-3 text-right font-medium text-[var(--color-text-primary)]">
                    {p.revenue > 0 ? (
                      fmt(p.revenue)
                    ) : (
                      <span className="text-[var(--color-text-muted)]">–</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right text-[var(--color-text-secondary)]">
                    {p.cost > 0 ? (
                      fmt(p.cost)
                    ) : (
                      <span className="text-[var(--color-text-muted)]">–</span>
                    )}
                  </td>
                </tr>
              ))}
              {stats.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-[var(--color-text-muted)]">
                    Ingen prosjekter ennå
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
