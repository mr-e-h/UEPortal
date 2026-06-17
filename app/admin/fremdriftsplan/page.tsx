import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { PROJECT_STAFF_ROLES } from '@/lib/roles'
import { getProjectScope } from '@/lib/api-guard'
import type { Project } from '@/types'
import FremdriftsplanClient, {
  type PhaseType,
  type ProjectPhase,
  type TimelineMilestone,
  type TimelineProject,
} from '@/components/admin/FremdriftsplanClient'

export const dynamic = 'force-dynamic'

/**
 * Fremdriftsplan — porteføljetidslinje: én rad per prosjekt, faser som
 * fargede bars, filtrerbar på fasetype/prosjekt/område.
 *
 * Tilgang: PROJECT_STAFF_ROLES (inkl. byggeleder). Scope-filteret avgrenser
 * PM/byggeleder til tildelte prosjekter. Siden viser INGEN økonomi.
 *
 * Robusthet: `phase_types`/`project_phases` finnes ikke i live-DB før
 * migrasjon 0002 er kjørt. Spørringene feiler da mykt (supabase returnerer
 * error uten å kaste) → vi viser prosjektperiodene som tidslinje og et
 * informasjonsbanner om at faser ikke er aktivert ennå.
 */
export default async function FremdriftsplanPage() {
  const me = await getSession()
  if (!me || !PROJECT_STAFF_ROLES.includes(me.role)) redirect('/login')

  const sb = getSupabaseAdmin()
  const scope = await getProjectScope(me)

  const { data: projData } = await sb
    .from('projects')
    .select('id, name, project_number, customer, county, status, start_date, end_date')
    .neq('deleted', true)
  let projects = (projData ?? []) as Pick<Project, 'id' | 'name' | 'project_number' | 'customer' | 'county' | 'status' | 'start_date' | 'end_date'>[]
  if (scope) projects = projects.filter((p) => scope.has(p.id))

  // Fase-data — myk feilhåndtering til migrasjon 0002 er kjørt mot live.
  let phaseTypes: PhaseType[] = []
  let phases: ProjectPhase[] = []
  let phasesAvailable = true

  const { data: ptData, error: ptErr } = await sb
    .from('phase_types')
    .select('id, name, color, is_active, sort_order')
    .order('sort_order')
  if (ptErr) {
    phasesAvailable = false
  } else {
    phaseTypes = (ptData ?? []) as PhaseType[]
  }

  if (phasesAvailable && projects.length > 0) {
    const { data: phData, error: phErr } = await sb
      .from('project_phases')
      .select('id, project_id, phase_type_id, name, start_date, end_date, status, progress_percent, sort_order, subcontractor_id')
      .in('project_id', projects.map((p) => p.id))
      .order('sort_order')
    if (phErr) {
      phasesAvailable = false
    } else {
      phases = (phData ?? []) as ProjectPhase[]
    }
  }

  // Gantt-milepæler (`milestones`-tabellen — samme kilde som /api/milestones
  // og prosjektets Fremdriftsplan-fane) — alle fremdriftsvisninger skal vise
  // samme innhold, uavhengig av hvilken av de to modellene dataene ligger i.
  let milestones: TimelineMilestone[] = []
  if (projects.length > 0) {
    const { data: msData } = await sb
      .from('milestones')
      .select('id, project_id, title, start_date, end_date, color')
      .in('project_id', projects.map((p) => p.id))
    milestones = (msData ?? []) as TimelineMilestone[]
  }

  // UE-filter: hvilke UE-er er tilknyttet de synlige prosjektene?
  const projectSubs: Record<string, string[]> = {}
  let subcontractors: Array<{ id: string; name: string }> = []
  if (projects.length > 0) {
    const { data: psData } = await sb
      .from('project_subcontractors')
      .select('project_id, subcontractor_id')
      .in('project_id', projects.map((p) => p.id))
    const psRows = (psData ?? []) as Array<{ project_id: string; subcontractor_id: string }>

    // Bygg opp project_id → [subcontractor_id] map.
    for (const row of psRows) {
      if (!projectSubs[row.project_id]) projectSubs[row.project_id] = []
      projectSubs[row.project_id].push(row.subcontractor_id)
    }

    // Hent kun UE-ene som faktisk er brukt på disse prosjektene.
    const usedIds = Array.from(new Set(psRows.map((r) => r.subcontractor_id)))
    if (usedIds.length > 0) {
      const { data: subData } = await sb
        .from('subcontractors')
        .select('id, company_name')
        .in('id', usedIds)
      subcontractors = ((subData ?? []) as Array<{ id: string; company_name: string }>)
        .map((s) => ({ id: s.id, name: s.company_name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
    }
  }

  const timelineProjects: TimelineProject[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    project_number: p.project_number,
    county: p.county,
    status: p.status,
    start_date: p.start_date,
    end_date: p.end_date,
  }))

  return (
    <FremdriftsplanClient
      projects={timelineProjects}
      phases={phases}
      phaseTypes={phaseTypes}
      milestones={milestones}
      phasesAvailable={phasesAvailable}
      subcontractors={subcontractors}
      projectSubs={projectSubs}
    />
  )
}
