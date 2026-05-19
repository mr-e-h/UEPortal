import { readJson } from '@/lib/data'
import type {
  Project,
  ProjectBudgetLine,
  WeeklyReport,
  WeeklyReportLine,
  ChangeOrder,
  HourEntry,
  Subcontractor,
} from '@/types'
import { getISOWeek, formatWeekLabel } from '@/lib/utils/weeks'
import DashboardClient from '@/components/admin/DashboardClient'
import type { WeekPoint } from '@/components/admin/DashboardChart'
import type { PendingRow } from '@/components/admin/PendingTable'
import type { ProjectBreakdown } from '@/components/admin/DashboardKpiCards'
import type { PendingCORow, ProjectStat } from '@/components/admin/DashboardClient'

type PeriodKey = '4w' | '12w' | 'ytd'

function weekList(count: number, currentWeek: number, thisYear: number): { week: number; year: number }[] {
  return Array.from({ length: count }, (_, i) => {
    let week = currentWeek - (count - 1 - i)
    let year = thisYear
    if (week <= 0) { week += 52; year = thisYear - 1 }
    return { week, year }
  })
}

export default async function AdminDashboard() {
  // Fire all reads in parallel. Sequential awaits added ~800ms (7×~110ms RTT
  // to Supabase EU); Promise.all collapses that to one roundtrip's worth.
  const [
    allProjects,
    allBudgetLines,
    allWeeklyReports,
    weeklyReportLines,
    allChangeOrders,
    allHourEntries,
    subcontractors,
  ] = await Promise.all([
    readJson<Project>('projects.json'),
    readJson<ProjectBudgetLine>('project_budget_lines.json'),
    readJson<WeeklyReport>('weekly_reports.json'),
    readJson<WeeklyReportLine>('weekly_report_lines.json'),
    readJson<ChangeOrder>('change_orders.json'),
    readJson<HourEntry>('hour_entries.json'),
    readJson<Subcontractor>('subcontractors.json'),
  ])

  const projects = allProjects.filter((p) => !p.deleted)
  const activeProjectIds = new Set(projects.map((p) => p.id))
  const budgetLines = allBudgetLines.filter((bl) => activeProjectIds.has(bl.project_id))
  const weeklyReports = allWeeklyReports.filter((r) => activeProjectIds.has(r.project_id))
  const changeOrders = allChangeOrders.filter((co) => activeProjectIds.has(co.project_id))
  const hourEntries = allHourEntries.filter((he) => activeProjectIds.has(he.project_id))

  const now = new Date()
  const thisYear = now.getFullYear()
  const currentWeek = getISOWeek(now)

  const blMap = new Map(budgetLines.map((b) => [b.id, b]))
  const projMap = new Map(projects.map((p) => [p.id, p]))
  const subMap = new Map(subcontractors.map((s) => [s.id, s]))

  // YTD KPI computations
  const approvedReportIds = new Set(
    weeklyReports
      .filter((r) => (r.status === 'approved' || r.status === 'partially_approved') && r.year === thisYear)
      .map((r) => r.id)
  )
  const approvedLines = weeklyReportLines.filter(
    (l) => approvedReportIds.has(l.weekly_report_id) && l.status === 'approved'
  )
  const approvedCOs = changeOrders.filter(
    // Use reviewed_at (approval date) for correct year attribution; fall back to submitted_at
    (co) => co.status === 'approved' && (co.reviewed_at ?? co.submitted_at)?.startsWith(String(thisYear))
  )
  const pendingCOs = changeOrders.filter((co) => co.status === 'pending')

  const yearRevenue =
    approvedLines.reduce(
      (s, l) => s + l.reported_quantity * (blMap.get(l.project_budget_line_id)?.customer_price_snapshot ?? 0),
      0
    ) + approvedCOs.reduce((s, co) => s + co.total_customer_value, 0)

  const yearCost =
    approvedLines.reduce(
      (s, l) =>
        s + l.reported_quantity * (blMap.get(l.project_budget_line_id)?.subcontractor_cost_price_snapshot ?? 0),
      0
    ) + approvedCOs.reduce((s, co) => s + co.total_cost, 0)

  const yearInternalCost = hourEntries
    .filter((he) => he.created_at.startsWith(String(thisYear)))
    .reduce((s, he) => s + he.hours * he.cost_per_hour_snapshot, 0)

  const yearProfit = yearRevenue - yearCost - yearInternalCost
  const profitMargin = yearRevenue > 0 ? Math.round((yearProfit / yearRevenue) * 100) : 0

  const pendingCOCount = pendingCOs.length
  const pendingCOValue = pendingCOs.reduce((s, co) => s + co.total_customer_value, 0)
  const pendingCOCost = pendingCOs.reduce((s, co) => s + co.total_cost, 0)

  const pendingReports = weeklyReports.filter((r) => r.status === 'submitted')
  const submittedThisWeek = weeklyReports.filter(
    (r) => r.year === thisYear && r.week_number === currentWeek && r.status !== 'draft'
  ).length

  // Per-project YTD breakdowns for KPI cards
  const projectBreakdowns: ProjectBreakdown[] = projects.map((proj) => {
    const projApprovedReportIds = new Set(
      weeklyReports
        .filter(
          (r) =>
            r.project_id === proj.id &&
            (r.status === 'approved' || r.status === 'partially_approved') &&
            r.year === thisYear
        )
        .map((r) => r.id)
    )
    const projApprovedLines = weeklyReportLines.filter(
      (l) => projApprovedReportIds.has(l.weekly_report_id) && l.status === 'approved'
    )
    const projApprovedCOs = changeOrders.filter(
      (co) =>
        co.project_id === proj.id &&
        co.status === 'approved' &&
        (co.reviewed_at ?? co.submitted_at)?.startsWith(String(thisYear))
    )
    const revenue =
      projApprovedLines.reduce(
        (s, l) => s + l.reported_quantity * (blMap.get(l.project_budget_line_id)?.customer_price_snapshot ?? 0),
        0
      ) + projApprovedCOs.reduce((s, co) => s + co.total_customer_value, 0)
    const cost =
      projApprovedLines.reduce(
        (s, l) =>
          s + l.reported_quantity * (blMap.get(l.project_budget_line_id)?.subcontractor_cost_price_snapshot ?? 0),
        0
      ) + projApprovedCOs.reduce((s, co) => s + co.total_cost, 0)
    const internalCost = hourEntries
      .filter((he) => he.project_id === proj.id && he.created_at.startsWith(String(thisYear)))
      .reduce((s, he) => s + he.hours * he.cost_per_hour_snapshot, 0)
    return { id: proj.id, name: proj.name, revenue, cost, internalCost, profit: revenue - cost - internalCost }
  })

  // Helper: compute chart points for a list of weeks
  function computeWeekPoints(weeks: { week: number; year: number }[]): WeekPoint[] {
    return weeks.map(({ week, year }) => {
      const idsForWeek = new Set(
        weeklyReports
          .filter(
            (r) =>
              r.year === year &&
              r.week_number === week &&
              (r.status === 'approved' || r.status === 'partially_approved')
          )
          .map((r) => r.id)
      )
      const linesForWeek = weeklyReportLines.filter(
        (l) => idsForWeek.has(l.weekly_report_id) && l.status === 'approved'
      )
      const omsetning = linesForWeek.reduce(
        (s, l) => s + l.reported_quantity * (blMap.get(l.project_budget_line_id)?.customer_price_snapshot ?? 0),
        0
      )
      const kostnad = linesForWeek.reduce(
        (s, l) =>
          s + l.reported_quantity * (blMap.get(l.project_budget_line_id)?.subcontractor_cost_price_snapshot ?? 0),
        0
      )
      return { week: `U${week}`, omsetning, kostnad }
    })
  }

  // Helper: compute per-project stats for a set of week/year pairs
  function computeProjectStats(weeks: { week: number; year: number }[]): ProjectStat[] {
    const weekSet = new Set(weeks.map((w) => `${w.year}-${w.week}`))
    const idsForPeriod = new Set(
      weeklyReports
        .filter(
          (r) =>
            weekSet.has(`${r.year}-${r.week_number}`) &&
            (r.status === 'approved' || r.status === 'partially_approved')
        )
        .map((r) => r.id)
    )
    const linesForPeriod = weeklyReportLines.filter(
      (l) => idsForPeriod.has(l.weekly_report_id) && l.status === 'approved'
    )
    return projects.map((proj) => {
      const projLines = linesForPeriod.filter(
        (l) => blMap.get(l.project_budget_line_id)?.project_id === proj.id
      )
      const revenue = projLines.reduce(
        (s, l) => s + l.reported_quantity * (blMap.get(l.project_budget_line_id)?.customer_price_snapshot ?? 0),
        0
      )
      const cost = projLines.reduce(
        (s, l) =>
          s + l.reported_quantity * (blMap.get(l.project_budget_line_id)?.subcontractor_cost_price_snapshot ?? 0),
        0
      )
      return {
        id: proj.id,
        name: proj.name,
        project_number: proj.project_number,
        customer: proj.customer,
        county: proj.county,
        status: proj.status,
        revenue,
        cost,
      }
    })
  }

  const weeks4 = weekList(4, currentWeek, thisYear)
  const weeks12 = weekList(12, currentWeek, thisYear)
  const weeksYTD = Array.from({ length: currentWeek }, (_, i) => ({ week: i + 1, year: thisYear }))

  const chartData: Record<PeriodKey, WeekPoint[]> = {
    '4w': computeWeekPoints(weeks4),
    '12w': computeWeekPoints(weeks12),
    'ytd': computeWeekPoints(weeksYTD),
  }

  const projectStatsData: Record<PeriodKey, ProjectStat[]> = {
    '4w': computeProjectStats(weeks4),
    '12w': computeProjectStats(weeks12),
    'ytd': computeProjectStats(weeksYTD),
  }

  // Pending weekly report rows
  const pendingRows: PendingRow[] = pendingReports.map((wr) => {
    const lines = weeklyReportLines.filter((l) => l.weekly_report_id === wr.id)
    const totalCost = lines.reduce(
      (s, l) =>
        s + l.reported_quantity * (blMap.get(l.project_budget_line_id)?.subcontractor_cost_price_snapshot ?? 0),
      0
    )
    const totalSales = lines.reduce(
      (s, l) => s + l.reported_quantity * (blMap.get(l.project_budget_line_id)?.customer_price_snapshot ?? 0),
      0
    )
    return {
      id: wr.id,
      project_name: projMap.get(wr.project_id)?.name ?? '–',
      sub_name: subMap.get(wr.subcontractor_id)?.company_name ?? '–',
      week_label: formatWeekLabel(wr.year, wr.week_number),
      submission_number: wr.submission_number ?? 1,
      line_count: lines.length,
      total_cost: totalCost,
      total_sales: totalSales,
      submitted_at: wr.submitted_at ? wr.submitted_at.split('T')[0] : '–',
    }
  })

  // Pending change order rows
  const pendingCORows: PendingCORow[] = pendingCOs.map((co) => ({
    id: co.id,
    project_name: projMap.get(co.project_id)?.name ?? '–',
    sub_name: subMap.get(co.subcontractor_id)?.company_name ?? '–',
    reason: co.reason ?? '',
    total_customer_value: co.total_customer_value,
    total_cost: co.total_cost,
    submitted_at: co.submitted_at ? co.submitted_at.split('T')[0] : null,
  }))

  return (
    <DashboardClient
      chartData={chartData}
      projectStats={projectStatsData}
      pendingCORows={pendingCORows}
      pendingReportRows={pendingRows}
      yearRevenue={yearRevenue}
      yearCost={yearCost}
      yearInternalCost={yearInternalCost}
      yearProfit={yearProfit}
      profitMargin={profitMargin}
      pendingCOCount={pendingCOCount}
      pendingCOValue={pendingCOValue}
      pendingCOCost={pendingCOCost}
      submittedThisWeek={submittedThisWeek}
      currentWeek={currentWeek}
      thisYear={thisYear}
      projectBreakdowns={projectBreakdowns}
    />
  )
}
