import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FileText, ClipboardList, Bell } from 'lucide-react'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getProjectScope } from '@/lib/api-guard'
import { ADMIN_ROLES } from '@/lib/roles'
import { formatWeekLabel } from '@/lib/utils/weeks'
import type {
  Project,
  ProjectBudgetLine,
  WeeklyReport,
  WeeklyReportLine,
  ChangeOrder,
  Subcontractor,
  Product,
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

  const [projectsRes, subsRes, prodsRes, pendingReportsRes, pendingCORes] = await Promise.all([
    sb.from('projects').select('id, name, project_number').neq('deleted', true),
    sb.from('subcontractors').select('id, company_name'),
    sb.from('products').select('id, name'),
    sb.from('weekly_reports').select('id, project_id, subcontractor_id, year, week_number, submitted_at, submission_number')
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: false }),
    sb.from('change_orders').select('id, project_id, subcontractor_id, product_id, requested_quantity, unit, total_cost, total_customer_value, reason, submitted_at')
      .eq('status', 'pending')
      .order('submitted_at', { ascending: false }),
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
  const products = ((prodsRes.data ?? []) as Pick<Product, 'id' | 'name'>[])
  const projectMap = new Map(projects.map((p) => [p.id, p]))
  const subMap = new Map(subs.map((s) => [s.id, s.company_name]))
  const productMap = new Map(products.map((p) => [p.id, p.name]))
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
    }
  })

  const coRows = pendingCOs.map((co) => ({
    id: co.id,
    project_name: projectMap.get(co.project_id)?.name ?? '–',
    project_number: projectMap.get(co.project_id)?.project_number ?? '',
    sub_name: subMap.get(co.subcontractor_id) ?? '–',
    product_name: productMap.get(co.product_id) ?? '–',
    quantity: co.requested_quantity,
    unit: co.unit,
    total_cost: co.total_cost,
    total_customer_value: co.total_customer_value,
    reason: co.reason ?? '',
    submitted_at: co.submitted_at ? co.submitted_at.split('T')[0] : '–',
  }))

  const totalPending = reportRows.length + coRows.length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Dashboard</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            {totalPending === 0
              ? 'Ingen oppgaver venter på godkjenning'
              : `${totalPending} ${totalPending === 1 ? 'oppgave venter' : 'oppgaver venter'} på godkjenning`}
          </p>
        </div>
        <Link
          href="/admin/totalokonomi"
          className="text-sm text-primary hover:underline font-medium"
        >
          Se totaløkonomi →
        </Link>
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
              {coRows.map((co) => (
                <li key={co.id}>
                  <Link
                    href={`/admin/change-orders/${co.id}`}
                    className="block px-5 py-3 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                          {co.product_name} <span className="text-[var(--color-text-muted)] font-normal">× {co.quantity} {co.unit}</span>
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                          {co.project_name} · {co.sub_name}
                        </p>
                        {co.reason && (
                          <p className="text-xs text-[var(--color-text-secondary)] truncate mt-1 italic">«{co.reason}»</p>
                        )}
                      </div>
                      <div className="text-right flex-none">
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{fmt(co.total_customer_value)}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">Salgsverdi</p>
                        <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{co.submitted_at}</p>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
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
              {reportRows.map((wr) => (
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
                      </div>
                      <div className="text-right flex-none">
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{fmt(wr.total_cost)}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">Kostnad</p>
                        <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{wr.submitted_at}</p>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
