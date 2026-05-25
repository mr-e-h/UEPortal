import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getProjectScope } from '@/lib/api-guard'
import { ADMIN_ROLES } from '@/lib/roles'
import type { Project, WeeklyReport, ChangeOrder, Subcontractor } from '@/types'
import { formatWeekLabel } from '@/lib/utils/weeks'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

export const dynamic = 'force-dynamic'

const RESULT_LIMIT = 25

function escapeForIlike(s: string): string {
  // PostgREST ilike uses % wildcards and treats backslash as escape — strip
  // wildcards from user input so a query like "100%" doesn't act like a
  // catch-all.
  return s.replace(/[%_\\]/g, (m) => `\\${m}`)
}

/**
 * Global search across projects / subs / weekly reports / change orders.
 *
 * Rewritten to use Postgres `ilike` against indexable columns instead of
 * pulling whole tables into Node and filtering with `.includes()`. PM-scope
 * is enforced server-side so a PM never sees rows for projects outside
 * their portfolio.
 */
export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const me = await getSession()
  if (!me || !ADMIN_ROLES.includes(me.role)) redirect('/login')

  const rawQ = (searchParams.q ?? '').trim()

  if (!rawQ) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">Søk</h1>
        <p className="text-sm text-[var(--color-text-muted)]">Skriv inn søkeord i søkefeltet øverst.</p>
      </div>
    )
  }

  const q = escapeForIlike(rawQ)
  const like = `%${q}%`
  const sb = getSupabaseAdmin()
  const scope = await getProjectScope(me)

  // Projects — 3 columns OR-matched via PostgREST `.or()` syntax.
  let projectQ = sb
    .from('projects')
    .select('id, name, project_number, customer, status, deleted')
    .neq('deleted', true)
    .or(`name.ilike.${like},project_number.ilike.${like},customer.ilike.${like}`)
    .limit(RESULT_LIMIT)
  if (scope) projectQ = projectQ.in('id', Array.from(scope))
  const { data: projData } = await projectQ
  const projects = (projData ?? []) as Project[]

  // Subcontractors — global (PMs share the UE catalog).
  const { data: subData } = await sb
    .from('subcontractors')
    .select('id, company_name, contact_person, email')
    .or(`company_name.ilike.${like},contact_person.ilike.${like},email.ilike.${like}`)
    .limit(RESULT_LIMIT)
  const subcontractors = (subData ?? []) as Subcontractor[]

  // Weekly reports — match via project name lookup. We need scoped project
  // ids first so the SQL can stay one query.
  let scopedProjectIds: string[] | null = null
  if (scope) {
    scopedProjectIds = Array.from(scope)
  } else {
    // Need a small id list of name-matching projects for the FK join below.
    // For non-PM roles this is everything matching the search.
    const { data: nameHits } = await sb
      .from('projects')
      .select('id')
      .or(`name.ilike.${like},project_number.ilike.${like}`)
      .neq('deleted', true)
    scopedProjectIds = (nameHits ?? []).map((p) => p.id as string)
  }

  // Use the matched projects as the join key for reports/COs since searching
  // weekly_reports text-fields directly isn't very useful (the descriptive
  // text lives on the parent project).
  let weeklyReports: WeeklyReport[] = []
  let changeOrders: ChangeOrder[] = []
  if (scopedProjectIds.length > 0) {
    const [wrRes, coRes] = await Promise.all([
      sb.from('weekly_reports')
        .select('*')
        .in('project_id', scopedProjectIds)
        .neq('status', 'draft')
        .order('submitted_at', { ascending: false })
        .limit(RESULT_LIMIT),
      sb.from('change_orders')
        .select('*')
        .in('project_id', scopedProjectIds)
        .neq('status', 'draft')
        .order('submitted_at', { ascending: false })
        .limit(RESULT_LIMIT),
    ])
    weeklyReports = (wrRes.data ?? []) as WeeklyReport[]
    changeOrders = (coRes.data ?? []) as ChangeOrder[]
  }

  // Project + sub maps for label rendering — only what we need.
  const projectIdsForLabels = new Set([
    ...projects.map((p) => p.id),
    ...weeklyReports.map((r) => r.project_id),
    ...changeOrders.map((co) => co.project_id),
  ])
  const subIdsForLabels = new Set([
    ...subcontractors.map((s) => s.id),
    ...weeklyReports.map((r) => r.subcontractor_id),
    ...changeOrders.map((co) => co.subcontractor_id),
  ])
  const [projLabelRes, subLabelRes] = await Promise.all([
    projectIdsForLabels.size > 0
      ? sb.from('projects').select('id, name, project_number, customer, status').in('id', Array.from(projectIdsForLabels))
      : Promise.resolve({ data: [] as Project[] }),
    subIdsForLabels.size > 0
      ? sb.from('subcontractors').select('id, company_name').in('id', Array.from(subIdsForLabels))
      : Promise.resolve({ data: [] as Subcontractor[] }),
  ])
  const projMap = new Map(((projLabelRes.data ?? []) as Project[]).map((p) => [p.id, p]))
  const subMap = new Map(((subLabelRes.data ?? []) as Subcontractor[]).map((s) => [s.id, s]))

  const total = projects.length + subcontractors.length + weeklyReports.length + changeOrders.length

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Søkeresultater for &ldquo;{rawQ}&rdquo;
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
          Ingen treff for &ldquo;{rawQ}&rdquo;
        </div>
      )}
    </div>
  )
}
