'use client'

import { useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import DashboardKpiCardsV2 from './DashboardKpiCardsV2'
import ActiveProjectsList, { type ActiveProjectRow } from './ActiveProjectsList'
import Card from '@/components/ui/Card'
import type { MonthBucket } from './MonthlyBarChart'
import type { WeekPoint } from './DashboardChart'
import type { PendingRow } from './PendingTable'
import type { ProjectBreakdown } from './DashboardKpiCards'
import type { ProjectStatus } from '@/types'

// Lazy-load both recharts-based charts so the charting lib is code-split out
// of the /admin/totalokonomi initial bundle (ssr:false is fine in this client
// component). KPI cards, period switcher and the projects list stay eager.
const DashboardChart = dynamic(() => import('./DashboardChart'), {
  ssr: false,
  loading: () => <div className="h-[200px] w-full animate-pulse rounded-lg bg-gray-100" />,
})
const MonthlyBarChart = dynamic(() => import('./MonthlyBarChart'), {
  ssr: false,
  loading: () => <div className="h-[280px] w-full animate-pulse rounded-lg bg-gray-100" />,
})

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
  'ytd': '1 år',
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
  monthlyBuckets: MonthBucket[]
}

export default function DashboardClient({
  chartData,
  projectStats,
  pendingReportRows,
  yearRevenue,
  yearCost,
  yearProfit,
  profitMargin,
  pendingCOCount,
  submittedThisWeek,
  currentWeek,
  thisYear,
  projectBreakdowns,
  monthlyBuckets,
}: Props) {
  const [period, setPeriod] = useState<PeriodKey>('12w')

  // Active projects list — each row carries actual + planned for both
  // revenue and cost so the bars can render planned-vs-actual pairs.
  // `projectBreakdowns` is the YTD breakdown which already includes
  // plannedRevenue + plannedCost.
  const activeProjectIds = useMemo(
    () => new Set(projectStats.ytd.filter((p) => p.status === 'active').map((p) => p.id)),
    [projectStats],
  )
  const activeProjects: ActiveProjectRow[] = useMemo(() => {
    return projectBreakdowns
      .filter((p) => activeProjectIds.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        actualRevenue: p.revenue,
        plannedRevenue: p.plannedRevenue,
        actualCost: p.cost,
        plannedCost: p.plannedCost,
        actualInternalCost: p.internalCost,
      }))
  }, [projectBreakdowns, activeProjectIds])

  return (
    <div className="p-6 space-y-6">
      <DashboardKpiCardsV2
        yearRevenue={yearRevenue}
        yearCost={yearCost}
        yearProfit={yearProfit}
        profitMargin={profitMargin}
        pendingReports={pendingReportRows.length}
        pendingCOCount={pendingCOCount}
        submittedThisWeek={submittedThisWeek}
        currentWeek={currentWeek}
      />

      {/* Omsetning over tid — full-width with period switcher */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            Omsetning over tid
          </h2>
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
        <DashboardChart data={chartData[period]} />
      </Card>

      {/* Per-month bars: omsetning / kostnad / fakturert for the whole year */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            Per måned {thisYear}
          </h2>
          <span className="text-xs text-[var(--color-text-muted)]">Omsetning · Kostnad · Fakturert</span>
        </div>
        <MonthlyBarChart data={monthlyBuckets} />
      </Card>

      <ActiveProjectsList projects={activeProjects} />
    </div>
  )
}
