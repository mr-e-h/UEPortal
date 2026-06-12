import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { PROJECT_STAFF_ROLES } from '@/lib/roles'
import { getProjectScope } from '@/lib/api-guard'
import type { WeeklyReport, Project, Subcontractor } from '@/types'
import { formatWeekLabel } from '@/lib/utils/weeks'
import WeeklyReportsListClient, { type ReportRow, type ReportStatus } from './WeeklyReportsListClient'

export const dynamic = 'force-dynamic'

export default async function WeeklyReportsPage() {
  const me = await getSession()
  // Project staff incl. byggeleder — weekly-report follow-up is core site-
  // manager work. The list shows status/week/UE only (no customer economics);
  // the scope filter below confines PM/byggeleder to assigned projects.
  if (!me || !PROJECT_STAFF_ROLES.includes(me.role)) redirect('/login')

  const sb = getSupabaseAdmin()
  const [projRes, repRes, subsRes] = await Promise.all([
    sb.from('projects').select('*').neq('deleted', true),
    sb.from('weekly_reports').select('*').neq('status', 'draft'),
    sb.from('subcontractors').select('*'),
  ])

  const projects = (projRes.data ?? []) as Project[]
  const subcontractors = (subsRes.data ?? []) as Subcontractor[]
  let reports = (repRes.data ?? []) as WeeklyReport[]

  // PM scope.
  const scope = await getProjectScope(me)
  if (scope) reports = reports.filter((r) => scope.has(r.project_id))

  const activeProjectIds = new Set(projects.map((p) => p.id))
  reports = reports
    .filter((r) => activeProjectIds.has(r.project_id))
    .sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))

  const projMap = new Map(projects.map((p) => [p.id, p]))
  const subMap = new Map(subcontractors.map((s) => [s.id, s]))

  const pending = reports.filter((r) => r.status === 'submitted')
  const approved = reports.filter((r) => r.status === 'approved' || r.status === 'partially_approved')
  const rejected = reports.filter((r) => r.status === 'rejected')

  // Flate, serialiserbare rader til klientfilteret — ingen økonomitall.
  const rows: ReportRow[] = reports.map((r) => ({
    id: r.id,
    project_name: projMap.get(r.project_id)?.name ?? '–',
    project_id: r.project_id,
    sub_name: subMap.get(r.subcontractor_id)?.company_name ?? '–',
    sub_id: r.subcontractor_id,
    week_label: formatWeekLabel(r.year, r.week_number),
    submitted: r.submitted_at ? r.submitted_at.split('T')[0] : '–',
    status: r.status as ReportStatus,
  }))

  // Filtermenyene viser kun prosjekter/UE-er som faktisk har rapporter.
  const repProjectIds = new Set(reports.map((r) => r.project_id))
  const filterProjects = projects
    .filter((p) => repProjectIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
  const repSubIds = new Set(reports.map((r) => r.subcontractor_id))
  const filterSubs = subcontractors
    .filter((s) => repSubIds.has(s.id))
    .map((s) => ({ id: s.id, name: s.company_name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Ukesrapporter</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            {pending.length} venter · {approved.length} godkjent · {rejected.length} avslått
          </p>
        </div>
      </div>

      <WeeklyReportsListClient rows={rows} projects={filterProjects} subs={filterSubs} />
    </div>
  )
}
