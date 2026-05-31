import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FileText, ClipboardList, Bell } from 'lucide-react'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getProjectScope } from '@/lib/api-guard'
import { ADMIN_ROLES } from '@/lib/roles'
import { formatWeekLabel } from '@/lib/utils/weeks'
import { osloYearMonth } from '@/lib/utils/dates'
import { fmtChangeOrderTitle } from '@/lib/format'
import { changeOrderType } from '@/lib/statuses'
import type { MonthBucket } from '@/components/admin/MonthlyBarChart'
import MonthlyChartWithPmFilter from '@/components/admin/MonthlyChartWithPmFilter'
import type {
  Project,
  ProjectBudgetLine,
  WeeklyReport,
  WeeklyReportLine,
  ChangeOrder,
  Subcontractor,
} from '@/types'

function fmt(n: number) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(n)
}

/**
 * Admin landing — focused inbox of ALL items waiting for the current
 * admin/PM to take action on. Wider portfolio numbers + charts moved to
 * /admin/totalokonomi so the dashboard does one job well: triage queue.
 *
 * Two columns:
 *   LEFT  — Endringsmeldinger som venter behandling (with project, sub,
 *           qty/value, submitted date). Click row → CO detail.
 *   RIGHT — Ukesrapporter som venter godkjenning (week label, project,
 *           sub, lines + total cost). Click row → weekly report detail.
 *
 * PM scope: project_manager users only see items from their assigned
 * projects (via getProjectScope). main / company / no-scope sees all.
 */
export default async function AdminDashboard() {
  const me = await getSession()
  if (!me || !ADMIN_ROLES.includes(me.role)) redirect('/login')

  const sb = getSupabaseAdmin()
  const scope = await getProjectScope(me)
  const thisYear = new Date().getFullYear()
  const yearStart = `${thisYear}-01-01`
  const yearEnd = `${thisYear}-12-31`

  const [
    projectsRes,
    subsRes,
    pendingReportsRes,
    pendingCORes,
    approvedReportsRes,
    approvedCORes,
    yearBudgetLinesRes,
    yearInvoicesRes,
    pmLinksRes,
    pmUsersRes,
  ] = await Promise.all([
    sb.from('projects').select('id, name, project_number').neq('deleted', true),
    sb.from('subcontractors').select('id, company_name'),
    sb.from('weekly_reports').select('id, project_id, subcontractor_id, year, week_number, status, submitted_at, submission_number')
      // 'partially_approved' is still NOT done — some lines need re-review,
      // so keep it on the dashboard until the rest is approved or rejected.
      .in('status', ['submitted', 'partially_approved'])
      .order('submitted_at', { ascending: false }),
    sb.from('change_orders').select('id, change_order_number, em_type, project_id, subcontractor_id, product_id, requested_quantity, unit, total_cost, total_customer_value, profit, reason, status, sent_to_customer_at, submitted_at, submitted_by')
      .eq('status', 'pending')
      .order('submitted_at', { ascending: false }),
    // For the monthly bar chart — approved reports submitted in current year.
    sb.from('weekly_reports')
      .select('id, project_id, status, submitted_at')
      .in('status', ['approved', 'partially_approved'])
      .eq('year', thisYear),
    // Approved change orders reviewed in current year (or submitted as fallback).
    sb.from('change_orders')
      .select('id, project_id, status, total_cost, total_customer_value, reviewed_at, submitted_at')
      .eq('status', 'approved')
      .gte('submitted_at', yearStart),
    sb.from('project_budget_lines')
      .select('id, project_id, customer_price_snapshot, subcontractor_cost_price_snapshot'),
    sb.from('project_invoices')
      .select('project_id, amount, invoice_date')
      .gte('invoice_date', yearStart)
      .lte('invoice_date', yearEnd),
    // PM filter on the bar chart needs project → PM linkage and PM names.
    sb.from('project_managers').select('project_id, user_id'),
    sb.from('users').select('id, full_name, role').eq('role', 'project_manager').eq('active', true),
  ])

  let pendingReports = ((pendingReportsRes.data ?? []) as WeeklyReport[])
  let pendingCOs = ((pendingCORes.data ?? []) as ChangeOrder[])
  if (scope) {
    pendingReports = pendingReports.filter((r) => scope.has(r.project_id))
    pendingCOs = pendingCOs.filter((co) => scope.has(co.project_id))
  }

  // Only fetch report lines + budget lines for the reports we kept — the
  // alternative (whole-table scan) blows up at growth.
  const reportIds = pendingReports.map((r) => r.id)
  const projectIds = Array.from(new Set([
    ...pendingReports.map((r) => r.project_id),
    ...pendingCOs.map((co) => co.project_id),
  ]))
  const [linesRes, blRes] = await Promise.all([
    reportIds.length > 0
      ? sb.from('weekly_report_lines').select('id, weekly_report_id, project_budget_line_id, reported_quantity').in('weekly_report_id', reportIds)
      : Promise.resolve({ data: [] as WeeklyReportLine[] }),
    projectIds.length > 0
      ? sb.from('project_budget_lines').select('id, project_id, subcontractor_cost_price_snapshot').in('project_id', projectIds)
      : Promise.resolve({ data: [] as Pick<ProjectBudgetLine, 'id' | 'project_id' | 'subcontractor_cost_price_snapshot'>[] }),
  ])
  const reportLines = (linesRes.data ?? []) as WeeklyReportLine[]
  const budgetLines = (blRes.data ?? []) as Pick<ProjectBudgetLine, 'id' | 'project_id' | 'subcontractor_cost_price_snapshot'>[]

  const projects = ((projectsRes.data ?? []) as Pick<Project, 'id' | 'name' | 'project_number'>[])
  const subs = ((subsRes.data ?? []) as Pick<Subcontractor, 'id' | 'company_name'>[])
  const projectMap = new Map(projects.map((p) => [p.id, p]))
  const subMap = new Map(subs.map((s) => [s.id, s.company_name]))
  const blMap = new Map(budgetLines.map((bl) => [bl.id, bl]))

  // Group report lines for cost computation
  const linesByReport = new Map<string, WeeklyReportLine[]>()
  for (const l of reportLines) {
    const arr = linesByReport.get(l.weekly_report_id) ?? []
    arr.push(l)
    linesByReport.set(l.weekly_report_id, arr)
  }

  const reportRows = pendingReports.map((wr) => {
    const lines = linesByReport.get(wr.id) ?? []
    const totalCost = lines.reduce((s, l) => {
      const bl = blMap.get(l.project_budget_line_id)
      return s + l.reported_quantity * (bl?.subcontractor_cost_price_snapshot ?? 0)
    }, 0)
    return {
      id: wr.id,
      project_name: projectMap.get(wr.project_id)?.name ?? '–',
      project_number: projectMap.get(wr.project_id)?.project_number ?? '',
      sub_name: subMap.get(wr.subcontractor_id) ?? '–',
      week_label: formatWeekLabel(wr.year, wr.week_number),
      submission_number: wr.submission_number ?? 1,
      line_count: lines.length,
      total_cost: totalCost,
      submitted_at: wr.submitted_at ? wr.submitted_at.split('T')[0] : '–',
      status: wr.status,
    }
  })

  const coRows = pendingCOs.map((co) => ({
    id: co.id,
    em_title: fmtChangeOrderTitle(co.change_order_number, projectMap.get(co.project_id)?.name),
    project_name: projectMap.get(co.project_id)?.name ?? '–',
    project_number: projectMap.get(co.project_id)?.project_number ?? '',
    sub_name: subMap.get(co.subcontractor_id) ?? '–',
    em_type: co.em_type,
    total_cost: co.total_cost,
    total_customer_value: co.total_customer_value,
    profit: co.profit,
    submitted_by: co.submitted_by ?? null,
    // Vis både dato og klokkeslett (Oslo) — admin trenger ofte å se
    // 'kom dette inn rett før møtet eller etterpå?'. Eksempel:
    // "28.05.2026 14:32".
    submitted_at: co.submitted_at
      ? new Date(co.submitted_at).toLocaleString('nb-NO', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'Europe/Oslo',
        })
      : '–',
    status: co.status,
    sent_to_customer: !!co.sent_to_customer_at,
  }))

  const totalPending = reportRows.length + coRows.length

  // ── Monthly bar chart bucketing ──────────────────────────────────────
  // Apply PM scope to all three time-series sources, then bucket by Oslo
  // month. Mirrors the same logic on /admin/totalokonomi so the two pages
  // agree on whatever single month you compare.
  const approvedReports = ((approvedReportsRes.data ?? []) as Array<{
    id: string; project_id: string; status: string; submitted_at: string | null
  }>).filter((r) => !scope || scope.has(r.project_id))
  const approvedCOs = ((approvedCORes.data ?? []) as Array<{
    id: string; project_id: string; total_cost: number; total_customer_value: number
    reviewed_at: string | null; submitted_at: string | null
  }>).filter((co) => !scope || scope.has(co.project_id))
  const yearBudgetLines = ((yearBudgetLinesRes.data ?? []) as Array<{
    id: string; customer_price_snapshot: number; subcontractor_cost_price_snapshot: number
  }>)
  const yearInvoices = ((yearInvoicesRes.data ?? []) as Array<{
    project_id: string; amount: number; invoice_date: string
  }>).filter((inv) => !scope || scope.has(inv.project_id))

  // Need the report LINES for approved reports to compute revenue/cost.
  const approvedReportIds = approvedReports.map((r) => r.id)
  const approvedLinesRes = approvedReportIds.length > 0
    ? await sb.from('weekly_report_lines')
        .select('id, weekly_report_id, project_budget_line_id, reported_quantity, status')
        .in('weekly_report_id', approvedReportIds)
        .eq('status', 'approved')
    : { data: [] as WeeklyReportLine[] }
  const approvedLines = (approvedLinesRes.data ?? []) as WeeklyReportLine[]
  const yearBlMap = new Map(yearBudgetLines.map((bl) => [bl.id, bl]))
  const reportMap = new Map(approvedReports.map((r) => [r.id, r]))

  const monthlyBuckets: MonthBucket[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: new Date(thisYear, i, 1).toLocaleDateString('nb-NO', { month: 'short' }),
    omsetning: 0,
    kostnad: 0,
    fakturert: 0,
  }))

  for (const line of approvedLines) {
    const report = reportMap.get(line.weekly_report_id)
    if (!report) continue
    const bucket = osloYearMonth(report.submitted_at)
    if (!bucket) continue
    const [y, m] = bucket.split('-').map((s) => parseInt(s, 10))
    if (y !== thisYear) continue
    const slot = monthlyBuckets[m - 1]
    if (!slot) continue
    const bl = yearBlMap.get(line.project_budget_line_id)
    if (!bl) continue
    slot.omsetning += line.reported_quantity * bl.customer_price_snapshot
    slot.kostnad += line.reported_quantity * bl.subcontractor_cost_price_snapshot
  }

  for (const co of approvedCOs) {
    const bucket = osloYearMonth(co.reviewed_at ?? co.submitted_at)
    if (!bucket) continue
    const [y, m] = bucket.split('-').map((s) => parseInt(s, 10))
    if (y !== thisYear) continue
    const slot = monthlyBuckets[m - 1]
    if (!slot) continue
    slot.omsetning += co.total_customer_value
    slot.kostnad += co.total_cost
  }

  // ── Per-PM filter prep ────────────────────────────────────────────────
  const pmLinks = (pmLinksRes.data ?? []) as Array<{ project_id: string; user_id: string }>
  const pmUsers = (pmUsersRes.data ?? []) as Array<{ id: string; full_name: string }>
  const pmInfo = pmUsers.map((u) => ({ id: u.id, name: u.full_name })).sort((a, b) => a.name.localeCompare(b.name, 'nb'))

  // Project → set of assigned PM-ids. A project can have multiple PMs;
  // when filtering by PM A, ALL of A's projects' numbers attribute to A.
  // Different PMs can therefore each see "their" view of a shared project.
  const projectPms = new Map<string, Set<string>>()
  for (const link of pmLinks) {
    const set = projectPms.get(link.project_id) ?? new Set<string>()
    set.add(link.user_id)
    projectPms.set(link.project_id, set)
  }

  // Per-PM clones of monthlyBuckets, all starting at zero.
  function emptyYearBuckets(): MonthBucket[] {
    return Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      label: new Date(thisYear, i, 1).toLocaleDateString('nb-NO', { month: 'short' }),
      omsetning: 0,
      kostnad: 0,
      fakturert: 0,
    }))
  }
  const byPmBuckets = new Map<string, MonthBucket[]>(
    pmInfo.map((pm) => [pm.id, emptyYearBuckets()]),
  )

  // Replay the same bucketing into the matching PM buckets.
  for (const line of approvedLines) {
    const report = reportMap.get(line.weekly_report_id)
    if (!report) continue
    const bucket = osloYearMonth(report.submitted_at)
    if (!bucket) continue
    const [y, m] = bucket.split('-').map((s) => parseInt(s, 10))
    if (y !== thisYear) continue
    const bl = yearBlMap.get(line.project_budget_line_id)
    if (!bl) continue
    const rev = line.reported_quantity * bl.customer_price_snapshot
    const cost = line.reported_quantity * bl.subcontractor_cost_price_snapshot
    const pmSet = projectPms.get(report.project_id)
    if (!pmSet) continue
    for (const pmId of Array.from(pmSet)) {
      const arr = byPmBuckets.get(pmId)
      if (!arr) continue
      arr[m - 1].omsetning += rev
      arr[m - 1].kostnad += cost
    }
  }
  for (const co of approvedCOs) {
    const bucket = osloYearMonth(co.reviewed_at ?? co.submitted_at)
    if (!bucket) continue
    const [y, m] = bucket.split('-').map((s) => parseInt(s, 10))
    if (y !== thisYear) continue
    const pmSet = projectPms.get(co.project_id)
    if (!pmSet) continue
    for (const pmId of Array.from(pmSet)) {
      const arr = byPmBuckets.get(pmId)
      if (!arr) continue
      arr[m - 1].omsetning += co.total_customer_value
      arr[m - 1].kostnad += co.total_cost
    }
  }
  for (const inv of yearInvoices) {
    const bucket = osloYearMonth(inv.invoice_date)
    if (!bucket) continue
    const [y, m] = bucket.split('-').map((s) => parseInt(s, 10))
    if (y !== thisYear) continue
    const slot = monthlyBuckets[m - 1]
    if (!slot) continue
    slot.fakturert += inv.amount
    // Same multi-PM attribution for invoiced amount.
    const pmSet = projectPms.get(inv.project_id)
    if (!pmSet) continue
    for (const pmId of Array.from(pmSet)) {
      const arr = byPmBuckets.get(pmId)
      if (!arr) continue
      arr[m - 1].fakturert += inv.amount
    }
  }

  // Materialize the byPm map as a plain object for serialization to the
  // client component.
  const byPm: Record<string, MonthBucket[]> = {}
  for (const [k, v] of Array.from(byPmBuckets)) byPm[k] = v

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Dashboard</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
          {totalPending === 0
            ? 'Ingen oppgaver venter på godkjenning'
            : `${totalPending} ${totalPending === 1 ? 'oppgave venter' : 'oppgaver venter'} på godkjenning`}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending change orders */}
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <FileText size={16} className="text-amber-600" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex-1">
              Endringsmeldinger til behandling
            </h2>
            {coRows.length > 0 && (
              <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                {coRows.length}
              </span>
            )}
          </div>
          {coRows.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--color-text-muted)] flex flex-col items-center gap-2">
              <Bell size={18} className="text-[var(--color-text-muted)]" />
              Ingen endringsmeldinger venter
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {coRows.map((co) => {
                const t = changeOrderType(co.em_type)
                return (
                <li key={co.id}>
                  <Link
                    href={`/admin/change-orders/${co.id}`}
                    className="block px-5 py-2 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                          {co.em_title}
                        </p>
                        {/* Type + status på samme rad, kompakt */}
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${t.cls}`}>{t.label}</span>
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              co.sent_to_customer
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {co.sent_to_customer ? 'Til behandling' : 'Ubehandlet'}
                          </span>
                          <span className="text-[10px] text-[var(--color-text-muted)] truncate">
                            {co.submitted_by ? `${co.submitted_by}, ${co.sub_name}` : co.sub_name} · {co.submitted_at}
                          </span>
                        </div>
                      </div>
                      {/* Salg → Kost → Fortjeneste, kompakt vertikal stack */}
                      <div className="text-right flex-none text-xs leading-tight tabular-nums">
                        <p className="font-semibold text-[var(--color-text-primary)]">{fmt(co.total_customer_value)}</p>
                        <p className="text-[var(--color-text-secondary)]">{fmt(co.total_cost)}</p>
                        <p className={`font-semibold ${co.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(co.profit)}</p>
                      </div>
                    </div>
                  </Link>
                </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Pending weekly reports */}
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
              <ClipboardList size={16} className="text-red-600" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex-1">
              Ukesrapporter til godkjenning
            </h2>
            {reportRows.length > 0 && (
              <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                {reportRows.length}
              </span>
            )}
          </div>
          {reportRows.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--color-text-muted)] flex flex-col items-center gap-2">
              <Bell size={18} className="text-[var(--color-text-muted)]" />
              Ingen ukesrapporter venter
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {reportRows.map((wr) => {
                const isPartial = wr.status === 'partially_approved'
                return (
                  <li key={wr.id}>
                    <Link
                      href={`/admin/weekly-reports/${wr.id}`}
                      className="block px-5 py-3 hover:bg-muted transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {wr.week_label}
                            {wr.submission_number > 1 && <span className="text-[var(--color-text-muted)] font-normal"> · innsending #{wr.submission_number}</span>}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                            {wr.project_name} · {wr.sub_name}
                          </p>
                          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                            {wr.line_count} {wr.line_count === 1 ? 'linje' : 'linjer'}
                          </p>
                          <span
                            className={`inline-flex items-center gap-1 mt-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              isPartial
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {isPartial ? 'Til behandling' : 'Ubehandlet'}
                          </span>
                        </div>
                        <div className="text-right flex-none">
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{fmt(wr.total_cost)}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">Kostnad</p>
                          <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{wr.submitted_at}</p>
                        </div>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Per-month bars: same data + bucketing as /admin/totalokonomi,
          mounted here so admins triaging the inbox can also see the
          year's economic shape at a glance. PM dropdown filters into
          per-PM views computed server-side. */}
      <MonthlyChartWithPmFilter
        year={thisYear}
        all={monthlyBuckets}
        byPm={byPm}
        pmList={pmInfo}
      />
    </div>
  )
}
