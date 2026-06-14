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
  Subcontractor,
  InternalHoursMonthly,
} from '@/types'
import { getISOWeek, formatWeekLabel, getISOWeeksInYear } from '@/lib/utils/weeks'
import { isInOsloYear, osloYearMonth } from '@/lib/utils/dates'
import { budgetSalesValue, emCustomerValue } from '@/lib/project-economy'
import {
  computeSpanISO, monthIndexFromISO, allocateActualInternalCost,
  type ProjectSpan, type MonthlyActual,
} from '@/lib/resource-allocation'
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
    subsRes,
    invoicesRes,
    phasesRes,
    milestonesRes,
    monthlyActualsRes,
  ] = await Promise.all([
    sb.from('projects').select('*').neq('deleted', true),
    sb.from('project_budget_lines').select('id, project_id, budget_quantity, customer_price_snapshot, subcontractor_cost_price_snapshot'),
    sb.from('weekly_reports').select('id, project_id, subcontractor_id, status, year, week_number, submitted_at, submission_number').gte('year', thisYear - 1).lte('year', thisYear),
    sb.from('change_orders').select('id, project_id, subcontractor_id, status, reviewed_at, submitted_at, total_customer_value, total_cost, reason').gte('submitted_at', lastYearStart).neq('status', 'draft'),
    sb.from('subcontractors').select('id, company_name'),
    // Invoices for the per-month bar chart — bounded to current year so we
    // don't ship a project's full billing history every dashboard render.
    sb.from('project_invoices').select('project_id, amount, invoice_date').gte('invoice_date', `${thisYear}-01-01`).lte('invoice_date', `${thisYear}-12-31`),
    // Internkost: prosjektenes aktive span (fremdriftsplan) + de avstemte
    // månedene. Den faktiske internkosten fordeles på prosjektene som var aktive
    // hver måned, vektet på omsetning — samme fordeling som ressurs-estimatet.
    sb.from('project_phases').select('project_id, start_date, end_date'),
    sb.from('milestones').select('project_id, start_date, end_date'),
    sb.from('internal_hours_monthly').select('*').eq('year', thisYear),
  ])

  const allProjects = (projectsRes.data ?? []) as Project[]
  const allBudgetLines = (budgetLinesRes.data ?? []) as ProjectBudgetLine[]
  const allWeeklyReports = (weeklyReportsRes.data ?? []) as WeeklyReport[]
  const allChangeOrders = (changeOrdersRes.data ?? []) as ChangeOrder[]
  const subcontractors = (subsRes.data ?? []) as Subcontractor[]
  const allInvoices = (invoicesRes.data ?? []) as Array<{ project_id: string; amount: number; invoice_date: string }>
  type DateRow = { project_id: string; start_date: string | null; end_date: string | null }
  const allPhases = (phasesRes.data ?? []) as DateRow[]
  const allMilestones = (milestonesRes.data ?? []) as DateRow[]
  const monthlyActuals = (monthlyActualsRes.data ?? []) as InternalHoursMonthly[]

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

  // `now` / `thisYear` were resolved at the top so we could bound queries
  // by year — reuse them here. Only the ISO week is needed locally.
  const currentWeek = getISOWeek(now)

  const blMap = new Map(budgetLines.map((b) => [b.id, b]))
  const projMap = new Map(projects.map((p) => [p.id, p]))
  const subMap = new Map(subcontractors.map((s) => [s.id, s]))

  // Group report lines by their parent report once, so the loops below can do
  // O(1) lookups instead of re-scanning the full weeklyReportLines array per
  // report/project. Pure internal optimisation — same lines, same order.
  const linesByReportId = new Map<string, WeeklyReportLine[]>()
  for (const l of weeklyReportLines) {
    const arr = linesByReportId.get(l.weekly_report_id)
    if (arr) arr.push(l)
    else linesByReportId.set(l.weekly_report_id, [l])
  }

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

  // ── Faktisk internkost (fra månedlig avstemming) ────────────────────────
  // Hvert prosjekts aktive span (fremdriftsplan, fallback prosjektdatoer) +
  // omsetning (ordrebok + godkjente EM-er). Den avstemte månedskosten fordeles
  // på prosjektene som var aktive den måneden, vektet på omsetning — nøyaktig
  // samme fordeling som ressurs-estimatet på Ressurser-siden. Fordelingen skjer
  // over prosjektene i scope (for PM: deres prosjekter), så ingen porteføljevid
  // data lekker; for main/company (scope = alle) er totalen den fulle internkosten.
  const phasesByProject = new Map<string, DateRow[]>()
  for (const r of allPhases) {
    const arr = phasesByProject.get(r.project_id)
    if (arr) arr.push(r); else phasesByProject.set(r.project_id, [r])
  }
  const milestonesByProject = new Map<string, DateRow[]>()
  for (const r of allMilestones) {
    const arr = milestonesByProject.get(r.project_id)
    if (arr) arr.push(r); else milestonesByProject.set(r.project_id, [r])
  }
  const internalSpans: ProjectSpan[] = []
  for (const p of projects) {
    const span = computeSpanISO(p, phasesByProject.get(p.id) ?? [], milestonesByProject.get(p.id) ?? [])
    if (!span) continue
    const lines = budgetLines.filter((bl) => bl.project_id === p.id)
    const ems = changeOrders.filter((co) => co.project_id === p.id && co.status === 'approved')
    internalSpans.push({
      id: p.id,
      name: p.name,
      revenue: budgetSalesValue(lines) + emCustomerValue(ems),
      startMonth: monthIndexFromISO(span.start),
      endMonth: monthIndexFromISO(span.end),
    })
  }
  const internalActuals: MonthlyActual[] = monthlyActuals.map((a) => ({
    year: a.year,
    month: a.month,
    cost: a.total_hours * a.hourly_cost_snapshot,
  }))
  const { byProject: internalCostByProject, total: yearInternalCost } =
    allocateActualInternalCost(internalActuals, internalSpans)

  const yearProfit = yearRevenue - yearCost - yearInternalCost
  const profitMargin = yearRevenue > 0 ? Math.round((yearProfit / yearRevenue) * 100) : 0

  const pendingCOCount = pendingCOs.length
  const pendingCOValue = pendingCOs.reduce((s, co) => s + co.total_customer_value, 0)
  const pendingCOCost = pendingCOs.reduce((s, co) => s + co.total_cost, 0)

  const pendingReports = weeklyReports.filter((r) => r.status === 'submitted')
  const submittedThisWeek = weeklyReports.filter(
    (r) => r.year === thisYear && r.week_number === currentWeek && r.status !== 'draft'
  ).length

  // Fakturert per prosjekt (hittil i år) — allInvoices er allerede avgrenset til
  // inneværende år i SQL-en. Filtreres til prosjekter i scope.
  const invoicedByProject = new Map<string, number>()
  for (const inv of allInvoices) {
    if (!activeProjectIds.has(inv.project_id)) continue
    invoicedByProject.set(inv.project_id, (invoicedByProject.get(inv.project_id) ?? 0) + (inv.amount ?? 0))
  }
  const yearInvoiced = Array.from(invoicedByProject.values()).reduce((s, v) => s + v, 0)

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
    // Faktisk internkost fra avstemmingen, fordelt på prosjektet (samme map som
    // global YTD-KPI, så total og per-prosjekt alltid stemmer overens).
    const internalCost = internalCostByProject.get(proj.id) ?? 0
    // Planned vs actual — baseline is the ORIGINAL budget, NOT including
    // EMs. (EMs expand scope; if you want including-EM later, add
    // approvedCOs.total_customer_value to plannedRevenue.)
    const projBudgetLines = budgetLines.filter((bl) => bl.project_id === proj.id)
    const plannedRevenue = projBudgetLines.reduce(
      (s, bl) => s + (bl.budget_quantity ?? 0) * (bl.customer_price_snapshot ?? 0),
      0,
    )
    const plannedCost = projBudgetLines.reduce(
      (s, bl) => s + (bl.budget_quantity ?? 0) * (bl.subcontractor_cost_price_snapshot ?? 0),
      0,
    )
    return {
      id: proj.id,
      name: proj.name,
      revenue,
      cost,
      internalCost,
      profit: revenue - cost - internalCost,
      plannedRevenue,
      plannedCost,
      invoiced: invoicedByProject.get(proj.id) ?? 0,
    }
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

  // Monthly bar chart — revenue, cost, invoiced bucketed into the 12 months
  // of the current year. Revenue/cost use the week's submitted_at (so a
  // late-reported week shows up in the month it was actually filed in),
  // not the report's `week_number`, since week-to-month mapping is ambiguous
  // for weeks that straddle months. Invoiced uses invoice_date directly.
  const monthlyBuckets = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: new Date(thisYear, i, 1).toLocaleDateString('nb-NO', { month: 'short' }),
    omsetning: 0,
    kostnad: 0,
    fakturert: 0,
  }))

  // Reports submitted (or approved) this year — bucket their lines into the
  // submitted_at month.
  for (const wr of weeklyReports) {
    if (wr.status !== 'approved' && wr.status !== 'partially_approved') continue
    const bucket = osloYearMonth(wr.submitted_at ?? null)
    if (!bucket) continue
    const [y, m] = bucket.split('-').map((s) => parseInt(s, 10))
    if (y !== thisYear) continue
    const slot = monthlyBuckets[m - 1]
    if (!slot) continue
    for (const l of linesByReportId.get(wr.id) ?? []) {
      if (l.status !== 'approved') continue
      const bl = blMap.get(l.project_budget_line_id)
      if (!bl) continue
      slot.omsetning += l.reported_quantity * bl.customer_price_snapshot
      slot.kostnad += l.reported_quantity * bl.subcontractor_cost_price_snapshot
    }
  }

  // Approved EMs — bucket by reviewed_at (or submitted_at fallback).
  for (const co of changeOrders) {
    if (co.status !== 'approved') continue
    const bucket = osloYearMonth(co.reviewed_at ?? co.submitted_at ?? null)
    if (!bucket) continue
    const [y, m] = bucket.split('-').map((s) => parseInt(s, 10))
    if (y !== thisYear) continue
    const slot = monthlyBuckets[m - 1]
    if (!slot) continue
    slot.omsetning += co.total_customer_value
    slot.kostnad += co.total_cost
  }

  // Project invoices — bucket by invoice_date (already filtered to this
  // year in the SQL query). PM scope: only count invoices for projects
  // the user can see.
  for (const inv of allInvoices) {
    if (!activeProjectIds.has(inv.project_id)) continue
    const bucket = osloYearMonth(inv.invoice_date)
    if (!bucket) continue
    const [y, m] = bucket.split('-').map((s) => parseInt(s, 10))
    if (y !== thisYear) continue
    const slot = monthlyBuckets[m - 1]
    if (!slot) continue
    slot.fakturert += inv.amount
  }

  // Pending weekly report rows
  const pendingRows: PendingRow[] = pendingReports.map((wr) => {
    const lines = linesByReportId.get(wr.id) ?? []
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
      yearInvoiced={yearInvoiced}
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
      monthlyBuckets={monthlyBuckets}
    />
  )
}
