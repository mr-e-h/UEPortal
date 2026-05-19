import { readJson } from '@/lib/data'
import type { Project, WeeklyReport, ChangeOrder, Subcontractor } from '@/types'
import { formatWeekLabel } from '@/lib/utils/weeks'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? '').toLowerCase().trim()

  if (!q) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">Søk</h1>
        <p className="text-sm text-[var(--color-text-muted)]">Skriv inn søkeord i søkefeltet øverst.</p>
      </div>
    )
  }

  const [allProjects, allSubs, allWeekly, allCOs] = await Promise.all([
    readJson<Project>('projects.json'),
    readJson<Subcontractor>('subcontractors.json'),
    readJson<WeeklyReport>('weekly_reports.json'),
    readJson<ChangeOrder>('change_orders.json'),
  ])

  const projects = allProjects.filter((p) => !p.deleted && (
    p.name.toLowerCase().includes(q) ||
    p.project_number?.toLowerCase().includes(q) ||
    p.customer?.toLowerCase().includes(q)
  ))

  const subcontractors = allSubs.filter((s) =>
    s.company_name.toLowerCase().includes(q) ||
    s.contact_person?.toLowerCase().includes(q) ||
    s.email?.toLowerCase().includes(q)
  )

  const subMap = new Map(allSubs.map((s) => [s.id, s]))
  const projMap = new Map(allProjects.filter((p) => !p.deleted).map((p) => [p.id, p]))

  const weeklyReports = allWeekly
    .filter((r) => r.status !== 'draft' && (
      projMap.get(r.project_id)?.name.toLowerCase().includes(q) ||
      subMap.get(r.subcontractor_id)?.company_name.toLowerCase().includes(q) ||
      formatWeekLabel(r.year, r.week_number).toLowerCase().includes(q)
    ))
    .slice(0, 10)

  const changeOrders = allCOs
    .filter((o) => o.status !== 'draft' && (
      projMap.get(o.project_id)?.name.toLowerCase().includes(q) ||
      subMap.get(o.subcontractor_id)?.company_name.toLowerCase().includes(q)
    ))
    .slice(0, 10)

  const total = projects.length + subcontractors.length + weeklyReports.length + changeOrders.length

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Søkeresultater for &ldquo;{searchParams.q}&rdquo;
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{total} treff</p>
      </div>

      {projects.length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Prosjekter ({projects.length})</h2>
          </div>
          <div className="divide-y divide-border">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/admin/projects/${p.id}`}
                className="flex items-center justify-between px-6 py-3 hover:bg-muted transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{p.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{p.project_number} · {p.customer}</p>
                </div>
                <Badge status={p.status === 'active' ? 'active' : 'draft'} />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {subcontractors.length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Underentreprenører ({subcontractors.length})</h2>
          </div>
          <div className="divide-y divide-border">
            {subcontractors.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-6 py-3">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{s.company_name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{s.contact_person} · {s.email}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {weeklyReports.length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Ukesrapporter ({weeklyReports.length})</h2>
          </div>
          <div className="divide-y divide-border">
            {weeklyReports.map((r) => (
              <Link
                key={r.id}
                href={`/admin/weekly-reports/${r.id}`}
                className="flex items-center justify-between px-6 py-3 hover:bg-muted transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {projMap.get(r.project_id)?.name ?? '–'} — {subMap.get(r.subcontractor_id)?.company_name ?? '–'}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">{formatWeekLabel(r.year, r.week_number)}</p>
                </div>
                <Badge status={r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'pending'} />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {changeOrders.length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Endringsmeldinger ({changeOrders.length})</h2>
          </div>
          <div className="divide-y divide-border">
            {changeOrders.map((o) => (
              <Link
                key={o.id}
                href={`/admin/change-orders/${o.id}`}
                className="flex items-center justify-between px-6 py-3 hover:bg-muted transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {projMap.get(o.project_id)?.name ?? '–'} — {subMap.get(o.subcontractor_id)?.company_name ?? '–'}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">{o.submitted_at?.split('T')[0] ?? '–'}</p>
                </div>
                <Badge status={o.status === 'approved' ? 'approved' : o.status === 'rejected' ? 'rejected' : 'pending'} />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {total === 0 && (
        <div className="py-16 text-center text-sm text-[var(--color-text-muted)]">
          Ingen treff for &ldquo;{searchParams.q}&rdquo;
        </div>
      )}
    </div>
  )
}
