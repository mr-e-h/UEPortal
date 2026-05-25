import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getProjectScope } from '@/lib/api-guard'
import { ADMIN_ROLES } from '@/lib/roles'
import type {
  Project,
  ProjectBudgetLine,
  WeeklyReport,
  WeeklyReportLine,
  ChangeOrder,
  HourEntry,
  Subcontractor,
} from '@/types'
import { getISOWeek, formatWeekLabel, getISOWeeksInYear } from '@/lib/utils/weeks'
import { isInOsloYear } from '@/lib/utils/dates'
import DashboardClient from '@/components/admin/DashboardClient'
import type { WeekPoint } from '@/components/admin/DashboardChart'
import type { PendingRow } from '@/components/admin/PendingTable'
import type { ProjectBreakdown } from '@/components/admin/DashboardKpiCards'
import type { PendingCORow, ProjectStat } from '@/components/admin/DashboardClient'

type PeriodKey = '4w' | '12w' | 'ytd'

/**
 * Build a rolling window of the last N ISO weeks, oldest first. Walks back
 * using getISOWeeksInYear so years with 53 weeks (2020, 2026, 2032…) are
 * traversed correctly instead of wrapping at 52.
 */
function weekList(count: number, currentWeek: number, thisYear: number): { week: number; year: number }[] {
  const out: { week: number; year: number }[] = []
  let week = currentWeek
  let year = thisYear
  for (let i = 0; i < count; i++) {
    out.unshift({ week, year })
    // step one week back
    if (week <= 1) {
      year -= 1
      week = getISOWeeksInYear(year)
    } else {
      week -= 1
    }
  }
  return out
}

export default async function AdminDashboard() {
  const me = await getSession()
  if (!me || !ADMIN_ROLES.includes(me.role)) redirect('/login')

  const sb = getSupabaseAdmin()
  const now = new Date()
  const thisYear = now.getFullYear()
  // Year bounds for time-series reads — dashboards only show 4w/12w/YTD
  // windows, none reach beyond last year. Bounding the load means even
  // 10 years of history stay cheap to render.
  const lastYearStart = `${thisYear - 1}-01-01`
  const scope = await getProjectScope(me)

  // Fire bounded reads in parallel. Years are filtered server-side so we
  // don't ship multi-year history over the wire. project_budget_lines and
  // subcontractors are needed in full for price snapshots + name lookups.
  const [
    projectsRes,
    budgetLinesRes,
    weeklyReportsRes,
    changeOrdersRes,
    hourEntriesRes,
    subsRes,
  ] = await Promise.all([
    sb.from('projects').select('*').neq('deleted', true),
    sb.from('project_budget_lines').select('id, project_id, customer_price_snapshot, subcontractor_cost_price_snapshot'),
    sb.from('weekly_reports').select('*').gte('year', thisYear - 1).lte('year', thisYear),
    sb.from('change_orders').select('*').gte('submitted_at', lastYearStart).neq('status', 'draft'),
    sb.from('hour_entries').select('*').gte('date', lastYearStart),
    sb.from('subcontractors').select('id, company_name'),
  ])

  const allProjects = (projectsRes.data ?? []) as Project[]
  const allBudgetLines = (budgetLinesRes.data ?? []) as ProjectBudgetLine[]
  const allWeeklyReports = (weeklyReportsRes.data ?? []) as WeeklyReport[]
  const allChangeOrders = (changeOrdersRes.data ?? []) as ChangeOrder[]
  const allHourEntries = (hourEntriesRes.data ?? []) as HourEntry[]
  const subcontractors = (subsRes.data ?? []) as Subcontractor[]

  // PM scope: project_manager dashboards see only the projects they're
  // assigned to. main / company see everything (scope is null). Every
  // downstream KPI/chart/table derives from `projects`, so filtering here
  // covers the entire dashboard in one place.
  const projects = allProjects.filter((p) => !scope || scope.has(p.id))
  const activeProjectIds = new Set(projects.map((p) => p.id))

  // Second pass: only fetch weekly_report_lines for the reports we kept.
  // Without this we'd download every line ever from the DB.
  const reportIdsInScope = allWeeklyReports
    .filter((r) => activeProjectIds.has(r.project_id))
    .map((r) => r.id)
  const wrlRes = reportIdsInScope.length > 0
    ? await sb.from('weekly_report_lines').select('*').in('weekly_report_id', reportIdsInScope)
    : { data: [] as WeeklyReportLine[] }
  const weeklyReportLines = (wrlRes.data ?? []) as WeeklyReportLine[]
  const budgetLines = allBudgetLines.filter((bl) => activeProjectIds.has(bl.project_id))
  const weeklyReports = allWeeklyReports.filter((r) => activeProjectIds.has(r.project_id))
  const changeOrders = allChangeOrders.filter((co) => activeProjectIds.has(co.project_id))
  const hourEntries = allHourEntries.filter((he) => activeProjectIds.has(he.project_id))

  // `now` / `thisYear` were resolved at the top so we could bound queries
  // by year — reuse them here. Only the ISO week is needed locally.
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
    // Year-bucket in Europe/Oslo time, not UTC — otherwise a CO approved
    // at 23:30 norsk tid on Dec 31 (= 22:30/21:30 UTC) gets attributed to
    // the wrong year compared to the Oslo-rendered dashboards.
    (co) => co.status === 'approved' && isInOsloYear(co.reviewed_at ?? co.submitted_at, thisYear)
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

  // Use the work date (`he.date`), not when the entry was typed in.
  // Backfilling a timesheet from last year should land in last year's KPI,
  // not today's. `he.date` is a date-only string so isInOsloYear takes the
  // cheap path (no timezone shift possible).
  const yearInternalCost = hourEntries
    .filter((he) => isInOsloYear(he.date, thisYear))
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
        isInOsloYear(co.reviewed_at ?? co.submitted_at, thisYear)
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
      // Use the WORK date, same as the global YTD KPI on line ~96 — was
      // mismatched (used created_at) so totals never agreed with per-project.
      .filter((he) => he.project_id === proj.id && isInOsloYear(he.date, thisYear))
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
