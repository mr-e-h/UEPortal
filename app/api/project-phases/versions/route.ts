import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireStaff, getProjectScope, isEmptyScope, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectPhase, GanttMilestone, ProjectPhaseVersion, ProjectPhaseSnapshot } from '@/types'

/**
 * Versjonshistorikk for fremdriftsplanen (0013). Et snapshot av hele planen
 * (faser + milepæler) per lagring, med hvem/når. Endringsloggen utledes ved å
 * diffe to versjoner i klienten (lib/phase-diff).
 *
 *   GET  — alt prosjektpersonell (scope-filtrert): historikken for ett prosjekt.
 *   POST — kun de med skrivetilgang (ansvarlig staff): tar et nytt snapshot av
 *          NÅVÆRENDE plan. Hopper over hvis identisk med forrige versjon
 *          (ingen reell endring → ingen ny logglinje).
 */

/** Stabil, sammenlignbar representasjon av et snapshot (kun meningsbærende felt). */
function normalize(snap: ProjectPhaseSnapshot): string {
  const p = (snap.phases ?? [])
    .map((x) => ({ id: x.id, t: x.phase_type_id, n: x.name ?? null, s: x.start_date, e: x.end_date ?? null, st: x.status, pr: x.progress_percent ?? 0, ue: x.subcontractor_id ?? null, w: x.weight ?? null }))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  const m = (snap.milestones ?? [])
    .map((x) => ({ id: x.id, ti: x.title, s: x.start_date, e: x.end_date ?? null, c: x.color ?? null }))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  return JSON.stringify({ p, m })
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })

  const scope = await getProjectScope(auth.user)
  if (isEmptyScope(scope)) return NextResponse.json([])
  if (scope && !scope.has(projectId)) {
    return NextResponse.json({ error: 'Ingen tilgang til prosjektet' }, { status: 403 })
  }

  const { data, error } = await getSupabaseAdmin()
    .from('project_phase_versions')
    .select('*')
    .eq('project_id', projectId)
    .order('taken_at', { ascending: false })
  // Tabell mangler (0013 ikke kjørt) → tom historikk i stedet for 500.
  if (error) return NextResponse.json([])
  return NextResponse.json((data ?? []) as ProjectPhaseVersion[])
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff()
  if (!auth.ok) return auth.response

  const body = await request.json() as { project_id?: string }
  if (!body.project_id) return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })

  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const sb = getSupabaseAdmin()
  // Nåværende plan rett fra tabellene (samme rekkefølge som visningene).
  const [{ data: phases }, { data: milestones }] = await Promise.all([
    sb.from('project_phases').select('*').eq('project_id', body.project_id).order('sort_order').order('start_date'),
    sb.from('milestones').select('*').eq('project_id', body.project_id).order('start_date'),
  ])
  const snapshot: ProjectPhaseSnapshot = {
    phases: (phases ?? []) as ProjectPhase[],
    milestones: (milestones ?? []) as GanttMilestone[],
  }

  // Dedup: hopp over hvis identisk med siste versjon (ingen reell endring).
  const { data: latest } = await sb
    .from('project_phase_versions')
    .select('snapshot')
    .eq('project_id', body.project_id)
    .order('taken_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ snapshot: ProjectPhaseSnapshot }>()
  if (latest && normalize(latest.snapshot) === normalize(snapshot)) {
    return NextResponse.json({ skipped: true }, { status: 200 })
  }

  const row: ProjectPhaseVersion = {
    id: randomUUID(),
    project_id: body.project_id,
    taken_at: new Date().toISOString(),
    taken_by: auth.user.id,
    taken_by_name: auth.user.full_name ?? auth.user.email ?? null,
    snapshot,
    created_at: new Date().toISOString(),
  }
  const { error } = await sb.from('project_phase_versions').insert(row)
  if (error) return NextResponse.json({ error: 'Kunne ikke lagre versjon' }, { status: 500 })
  return NextResponse.json(row, { status: 201 })
}
