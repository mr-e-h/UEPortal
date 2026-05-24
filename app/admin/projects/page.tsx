import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { ADMIN_ROLES } from '@/lib/roles'
import { getProjectScope } from '@/lib/api-guard'
import type { Project, ProjectBudgetLine, ProjectSubcontractor } from '@/types'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import ProjectsListTable from '@/components/admin/ProjectsListTable'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const me = await getSession()
  if (!me || !ADMIN_ROLES.includes(me.role)) redirect('/login')

  const sb = getSupabaseAdmin()
  // PM scope: project_manager users only see their assigned projects.
  // main / company see all (returns null).
  const scope = await getProjectScope(me)

  const [projRes, blRes, psRes] = await Promise.all([
    sb.from('projects').select('*').neq('deleted', true),
    sb.from('project_budget_lines').select('project_id'),
    sb.from('project_subcontractors').select('project_id'),
  ])

  let projects = (projRes.data ?? []) as Project[]
  if (scope) projects = projects.filter((p) => scope.has(p.id))
  const budgetLines = (blRes.data ?? []) as Pick<ProjectBudgetLine, 'project_id'>[]
  const projectSubs = (psRes.data ?? []) as Pick<ProjectSubcontractor, 'project_id'>[]

  const blCounts: Record<string, number> = {}
  for (const bl of budgetLines) {
    blCounts[bl.project_id] = (blCounts[bl.project_id] ?? 0) + 1
  }
  const subCounts: Record<string, number> = {}
  for (const ps of projectSubs) {
    subCounts[ps.project_id] = (subCounts[ps.project_id] ?? 0) + 1
  }

  const active = projects.filter((p) => p.status === 'active')
  const rest = projects.filter((p) => p.status !== 'active')

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Prosjekter</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{active.length} aktive · {rest.length} avsluttede</p>
        </div>
        <Button href="/admin/projects/new" variant="primary" className="px-3 py-1.5 text-xs">
          + Nytt prosjekt
        </Button>
      </div>

      <Card>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Aktive prosjekter</h2>
        </div>
        <ProjectsListTable projects={active} blCounts={blCounts} subCounts={subCounts} />
      </Card>

      {rest.length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Avsluttede / arkiverte</h2>
          </div>
          <ProjectsListTable projects={rest} blCounts={blCounts} subCounts={subCounts} />
        </Card>
      )}
    </div>
  )
}
