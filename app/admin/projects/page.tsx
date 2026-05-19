import { readJson } from '@/lib/data'
import type { Project, ProjectBudgetLine } from '@/types'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import ProjectsListTable from '@/components/admin/ProjectsListTable'

export default async function ProjectsPage() {
  const projects = (await readJson<Project>('projects.json')).filter((p) => !p.deleted)
  const budgetLines = await readJson<ProjectBudgetLine>('project_budget_lines.json')
  const projectSubs = await readJson<{ id: string; project_id: string; subcontractor_id: string }>('project_subcontractors.json')

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
