import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { PROJECT_STAFF_ROLES } from '@/lib/roles'
import { getProjectScope } from '@/lib/api-guard'
import type { WeeklyReport, Project, Subcontractor } from '@/types'
import { formatWeekLabel } from '@/lib/utils/weeks'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

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

      {pending.length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Venter godkjenning</h2>
            <span className="bg-primary text-white text-xs font-medium px-1.5 py-0.5 rounded-full">
              {pending.length}
            </span>
          </div>
          <ReportTable reports={pending} projMap={projMap} subMap={subMap} />
        </Card>
      )}

      <Card>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Alle innsendte rapporter</h2>
        </div>
        <ReportTable reports={reports} projMap={projMap} subMap={subMap} />
      </Card>
    </div>
  )
}

function ReportTable({
  reports,
  projMap,
  subMap,
}: {
  reports: WeeklyReport[]
  projMap: Map<string, Project>
  subMap: Map<string, Subcontractor>
}) {
  if (reports.length === 0) {
    return <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Ingen rapporter</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Prosjekt', 'Underentreprenør', 'Uke', '#', 'Innsendt', 'Status', ''].map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted transition-colors">
              <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">
                {projMap.get(r.project_id)?.name ?? '–'}
              </td>
              <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">
                {subMap.get(r.subcontractor_id)?.company_name ?? '–'}
              </td>
              <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">
                {formatWeekLabel(r.year, r.week_number)}
              </td>
              <td className="px-4 py-2.5 text-[var(--color-text-muted)]">#{r.submission_number ?? 1}</td>
              <td className="px-4 py-2.5 text-[var(--color-text-muted)]">
                {r.submitted_at ? r.submitted_at.split('T')[0] : '–'}
              </td>
              <td className="px-4 py-2.5">
                <Badge
                  status={
                    r.status === 'approved' ? 'approved'
                    : r.status === 'rejected' ? 'rejected'
                    : 'pending'
                  }
                />
              </td>
              <td className="px-4 py-2.5 text-right">
                <Link
                  href={`/admin/weekly-reports/${r.id}`}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Detaljer →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
