'use client'

import { useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import DashboardKpiCardsV2 from './DashboardKpiCardsV2'
import ProjectEconomyTable, { type ProjectEconomyRow } from './ProjectEconomyTable'
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
  loading: () => <div className="h-[200px] w-full animate-pulse rounded-lg bg-muted" />,
})
const MonthlyBarChart = dynamic(() => import('./MonthlyBarChart'), {
  ssr: false,
  loading: () => <div className="h-[280px] w-full animate-pulse rounded-lg bg-muted" />,
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

type ChartView = 'uke' | 'mnd'

type Props = {
  chartData: Record<PeriodKey, WeekPoint[]>
  projectStats: Record<PeriodKey, ProjectStat[]>
  pendingCORows: PendingCORow[]
  pendingReportRows: PendingRow[]
  yearRevenue: number
  yearInvoiced: number
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
  yearInvoiced,
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
  const [chartView, setChartView] = useState<ChartView>('uke')

  // Active projects list — each row carries actual + planned for both
  // revenue and cost. `projectBreakdowns` is the YTD breakdown which already
  // includes plannedRevenue + plannedCost.
  const activeProjectIds = useMemo(
    () => new Set(projectStats.ytd.filter((p) => p.status === 'active').map((p) => p.id)),
    [projectStats],
  )
  const activeProjects: ProjectEconomyRow[] = useMemo(() => {
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
        invoiced: p.invoiced,
      }))
  }, [projectBreakdowns, activeProjectIds])

  return (
    <div className="p-6 space-y-6">
      <DashboardKpiCardsV2
        yearRevenue={yearRevenue}
        yearInvoiced={yearInvoiced}
        yearCost={yearCost}
        yearProfit={yearProfit}
        profitMargin={profitMargin}
        pendingReports={pendingReportRows.length}
        pendingCOCount={pendingCOCount}
        submittedThisWeek={submittedThisWeek}
        currentWeek={currentWeek}
      />

      {/* Utvikling over tid — ett kort med veksling mellom uke og måned, så de
          to grafene ikke stables og tar dobbelt så mye plass. */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
              Utvikling over tid
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {chartView === 'uke'
                ? 'Godkjent omsetning vs. UE-kostnad per uke'
                : `Omsetning, kostnad og fakturering per måned ${thisYear}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Periodevelger — kun relevant for ukesvisningen */}
            {chartView === 'uke' && (
              <div className="flex gap-1 bg-muted rounded-lg p-0.5">
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
            )}
            {/* Uke / måned-veksling */}
            <div className="flex gap-1 bg-muted rounded-lg p-0.5">
              {([['uke', 'Per uke'], ['mnd', 'Per måned']] as [ChartView, string][]).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setChartView(k)}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                    chartView === k
                      ? 'bg-white text-[var(--color-text-primary)] shadow-sm'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {chartView === 'uke'
          ? <DashboardChart data={chartData[period]} />
          : <MonthlyBarChart data={monthlyBuckets} />}
      </Card>

      <ProjectEconomyTable projects={activeProjects} />
    </div>
  )
}
