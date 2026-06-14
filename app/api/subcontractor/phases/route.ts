import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { resolveEffectiveSub } from '@/lib/tender'
import type { PhaseType, ProjectPhase } from '@/types'

/**
 * GET /api/subcontractor/phases?project_id=X
 *
 * Security:
 *   - Identity comes strictly from the session via resolveEffectiveSub (not URL params).
 *   - Only returns data if the UE is a member of the requested project
 *     (project_subcontractors row must exist).
 *   - No economy/prices: phases carry none, and we do not add any.
 *   - Soft-fail to empty arrays if the phases tables are missing (pre-migration).
 *
 * Response: { phases: ProjectPhase[], phaseTypes: PhaseType[] }
 */
export async function GET(request: NextRequest) {
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })

  const sb = getSupabaseAdmin()

  // Verify UE membership in this project.
  const { data: memberRow } = await sb
    .from('project_subcontractors')
    .select('id')
    .eq('project_id', projectId)
    .eq('subcontractor_id', eff.subId)
    .maybeSingle()

  if (!memberRow) {
    // UE is not a member of this project — return empty rather than 403 so
    // the UI can distinguish "no access" from a server error gracefully.
    return NextResponse.json({ phases: [], phaseTypes: [] })
  }

  // Fetch phase types (global registry).
  const { data: ptData, error: ptErr } = await sb
    .from('phase_types')
    .select('id, name, color, is_active, sort_order')
    .order('sort_order')

  if (ptErr) {
    // Table not yet migrated — soft-fail.
    return NextResponse.json({ phases: [], phaseTypes: [] })
  }

  const phaseTypes = (ptData ?? []) as PhaseType[]

  // Fetch all phases for the project (all UEs see the full schedule —
  // no economy data is present on this table).
  const { data: phData, error: phErr } = await sb
    .from('project_phases')
    .select('id, project_id, phase_type_id, name, start_date, end_date, status, progress_percent, sort_order, subcontractor_id')
    .eq('project_id', projectId)
    .order('sort_order')

  if (phErr) {
    // Table not yet migrated — soft-fail.
    return NextResponse.json({ phases: [], phaseTypes: [] })
  }

  const phases = (phData ?? []) as ProjectPhase[]

  return NextResponse.json({ phases, phaseTypes })
}
