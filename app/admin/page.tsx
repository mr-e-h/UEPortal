import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FileText, ClipboardList, ChevronRight } from 'lucide-react'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getProjectScope } from '@/lib/api-guard'
import { ADMIN_ROLES, PROJECT_STAFF_ROLES } from '@/lib/roles'
import { EM_NEEDS_ACTION, WR_NEEDS_ACTION } from '@/lib/attention'
import { osloYearMonth } from '@/lib/utils/dates'
import type { MonthBucket } from '@/components/admin/MonthlyBarChart'
import MonthlyChartWithPmFilter from '@/components/admin/MonthlyChartWithPmFilter'
import type { WeeklyReportLine } from '@/types'

/**
 * Admin landing — to ting:
 *   1. To telle-bokser: antall ubehandlede endringsmeldinger + ukesrapporter
 *      til godkjenning (ikke forhåndsvisning — klikk for å gå til køen).
 *   2. Månedsøkonomi {år} (omsetning/kostnad/fakturert) for økonomiroller.
 *
 * PM-scope: project_manager ser bare egne prosjekter (getProjectScope).
 * Byggeleder ser telle-boksene (triage), men ikke kundeøkonomi-grafen —
 * den rendres aldri inn i HTML-en for byggeleder.
 */
export default async function AdminDashboard() {
  const me = await getSession()
  if (!me || !PROJECT_STAFF_ROLES.includes(me.role)) redirect('/login')

  const canSeeEconomy = ADMIN_ROLES.includes(me.role)

  const sb = getSupabaseAdmin()
  const scope = await getProjectScope(me)
  const thisYear = new Date().getFullYear()
  const yearStart = `${thisYear}-01-01`
  const yearEnd = `${thisYear}-12-31`

  const [
    pendingReportsRes,
    pendingCORes,
    approvedReportsRes,
    approvedCORes,
    yearBudgetLinesRes,
    yearInvoicesRes,
    pmLinksRes,
    pmUsersRes,
  ] = await Promise.all([
    // Bare antall trengs — «krever handling»-definisjonen bor i lib/attention.ts.
    sb.from('weekly_reports').select('id, project_id').in('status', [...WR_NEEDS_ACTION]),
    sb.from('change_orders').select('id, project_id').in('status', [...EM_NEEDS_ACTION]),
    // Månedsgraf — godkjente rapporter/EM-er + fakturaer i inneværende år.
    sb.from('weekly_reports')
      .select('id, project_id, status, submitted_at')
      .in('status', ['approved', 'partially_approved'])
      .eq('year', thisYear),
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
    sb.from('project_managers').select('project_id, user_id'),
    sb.from('users').select('id, full_name, role').eq('role', 'project_manager').eq('active', true),
  ])

  // ── Telle-bokser ────────────────────────────────────────────────────────
  let pendingReports = (pendingReportsRes.data ?? []) as Array<{ id: string; project_id: string }>
  let pendingCOs = (pendingCORes.data ?? []) as Array<{ id: string; project_id: string }>
  if (scope) {
    pendingReports = pendingReports.filter((r) => scope.has(r.project_id))
    pendingCOs = pendingCOs.filter((co) => scope.has(co.project_id))
  }
  const wrCount = pendingReports.length
  const coCount = pendingCOs.length
  const totalPending = wrCount + coCount

  // ── Månedsgraf-bøtting (uendret logikk; speiler /admin/totalokonomi) ──────
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

  const projectPms = new Map<string, Set<string>>()
  for (const link of pmLinks) {
    const set = projectPms.get(link.project_id) ?? new Set<string>()
    set.add(link.user_id)
    projectPms.set(link.project_id, set)
  }

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
    const pmSet = projectPms.get(inv.project_id)
    if (!pmSet) continue
    for (const pmId of Array.from(pmSet)) {
      const arr = byPmBuckets.get(pmId)
      if (!arr) continue
      arr[m - 1].fakturert += inv.amount
    }
  }

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

      {/* To telle-bokser — klikk for å gå til køen. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <Link
          href="/admin/change-orders"
          className="group bg-card border border-border rounded-2xl p-6 hover:border-[var(--color-border-strong)] hover:shadow-sm transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center">
              <FileText size={20} className="text-amber-600" />
            </div>
            <ChevronRight size={18} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]" />
          </div>
          <p className="text-3xl font-bold text-[var(--color-text-primary)] mt-4 tabular-nums">{coCount}</p>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">Endringsmeldinger til behandling</p>
        </Link>

        <Link
          href="/admin/weekly-reports"
          className="group bg-card border border-border rounded-2xl p-6 hover:border-[var(--color-border-strong)] hover:shadow-sm transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center">
              <ClipboardList size={20} className="text-amber-600" />
            </div>
            <ChevronRight size={18} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]" />
          </div>
          <p className="text-3xl font-bold text-[var(--color-text-primary)] mt-4 tabular-nums">{wrCount}</p>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">Ukesrapporter til godkjenning</p>
        </Link>
      </div>

      {/* Månedsøkonomi — vises direkte (kundeøkonomi → kun main/company/PM). */}
      {canSeeEconomy && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Månedsøkonomi {thisYear}</h2>
          <MonthlyChartWithPmFilter
            year={thisYear}
            all={monthlyBuckets}
            byPm={byPm}
            pmList={pmInfo}
          />
        </section>
      )}
    </div>
  )
}
