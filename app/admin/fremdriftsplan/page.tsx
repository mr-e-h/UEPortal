import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { PROJECT_STAFF_ROLES } from '@/lib/roles'
import { getProjectScope } from '@/lib/api-guard'
import type { Project } from '@/types'
import FremdriftsplanClient, {
  type PhaseType,
  type ProjectPhase,
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
      .select('id, project_id, phase_type_id, name, start_date, end_date, status, progress_percent, sort_order')
      .in('project_id', projects.map((p) => p.id))
      .order('sort_order')
    if (phErr) {
      phasesAvailable = false
    } else {
      phases = (phData ?? []) as ProjectPhase[]
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
      phasesAvailable={phasesAvailable}
    />
  )
}
