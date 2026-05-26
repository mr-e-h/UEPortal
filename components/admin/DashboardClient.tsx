'use client'

import { useState, useMemo } from 'react'
import DashboardChart from './DashboardChart'
import DashboardKpiCardsV2 from './DashboardKpiCardsV2'
import AttentionFeed, { type AttentionItem } from './AttentionFeed'
import ActiveProjectsList, { type ActiveProjectRow } from './ActiveProjectsList'
import Card from '@/components/ui/Card'
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
  'ytd': '1 år',
}

// Margin target — projects with margin under this threshold surface in the
// attention feed as "Margin under mål". Easy to lift to config later if
// admin wants per-project or per-customer thresholds.
const MARGIN_TARGET_PCT = 15

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
  yearProfit,
  profitMargin,
  pendingCOCount,
  submittedThisWeek,
  currentWeek,
  projectBreakdowns,
}: Props) {
  const [period, setPeriod] = useState<PeriodKey>('12w')

  // Attention feed — pending reports first, then EMs, then margin warnings.
  // Compact: one row per category, with a count, not one row per item.
  const attentionItems: AttentionItem[] = useMemo(() => {
    const items: AttentionItem[] = []

    if (pendingReportRows.length > 0) {
      const subsSet = new Set(pendingReportRows.map((r) => r.sub_name))
      items.push({
        kind: 'weekly_report',
        count: pendingReportRows.length,
        week: currentWeek,
        submittedBy: subsSet.size,
      })
    }

    if (pendingCOCount > 0) {
      items.push({ kind: 'change_order', count: pendingCOCount })
    }

    // Margin warnings — only flag projects that actually have revenue,
    // otherwise a brand-new project (0/0) reads as -∞ % margin.
    const lowMargin = projectBreakdowns
      .filter((p) => p.revenue > 0 && (p.profit / p.revenue) * 100 < MARGIN_TARGET_PCT)
      .sort((a, b) => a.profit / a.revenue - b.profit / b.revenue)
    if (lowMargin.length > 0) {
      items.push({
        kind: 'margin_warning',
        count: lowMargin.length,
        projectName: lowMargin[0].name,
        projectId: lowMargin[0].id,
      })
    }
    return items
  }, [pendingReportRows, pendingCOCount, currentWeek, projectBreakdowns])

  // Active projects list — rev as headline value, % computed against the
  // project's BUDGET from breakdowns (cost / budget). Fall back to revenue
  // share of yearRevenue as a coarse progress proxy if no per-project budget.
  const activeProjects: ActiveProjectRow[] = useMemo(() => {
    return projectStats.ytd
      .filter((p) => p.status === 'active')
      .map((p) => {
        // Progress proxy: revenue this project / its budget approximation.
        // We don't have per-project budget in the props yet, so use revenue
        // share of the totalled year revenue across active projects.
        const totalActive = projectStats.ytd
          .filter((x) => x.status === 'active')
          .reduce((s, x) => s + x.revenue, 0)
        const pct = totalActive > 0 ? (p.revenue / totalActive) * 100 : 0
        return {
          id: p.id,
          name: p.name,
          revenue: p.revenue,
          progressPct: pct,
        }
      })
  }, [projectStats])

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

      {/* Bottom row: action feed + active projects */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AttentionFeed items={attentionItems} />
        <ActiveProjectsList projects={activeProjects} />
      </div>
    </div>
  )
}
