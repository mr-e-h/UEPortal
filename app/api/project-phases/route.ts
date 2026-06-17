import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import {
  requireStaff, requireAdmin, getProjectScope, isEmptyScope, ensureProjectWritable,
} from '@/lib/api-guard'
import type { ProjectPhase } from '@/components/admin/FremdriftsplanClient'

/**
 * Arbeidsfaser per prosjekt (fremdriftsplan-datamodellen fra 0002).
 *
 * Tilgang:
 *   GET  — alt prosjektpersonell (main/company/PL/byggeleder), scope-filtrert:
 *          PL/byggeleder ser kun faser på tildelte prosjekter. Ingen økonomi.
 *   POST — kun ADMIN_ROLES (main/company/PL) på skrivbare prosjekter.
 *          Byggeleder kan IKKE opprette faser (kun status/progress via PATCH).
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaff()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  const scope = await getProjectScope(auth.user)
  // Tom scope = ingen tildelte prosjekter → ingenting (aldri "alt").
  if (isEmptyScope(scope)) return NextResponse.json([])
  if (projectId && scope && !scope.has(projectId)) {
    return NextResponse.json({ error: 'Ingen tilgang til prosjektet' }, { status: 403 })
  }

  const sb = getSupabaseAdmin()
  let q = sb
    .from('project_phases')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('start_date', { ascending: true })
  if (projectId) q = q.eq('project_id', projectId)
  else if (scope) q = q.in('project_id', Array.from(scope))

  const { data, error } = await q
  // Tabell mangler (0002 ikke kjørt) → tom liste, samme fallback som siden.
  if (error) return NextResponse.json([])
  return NextResponse.json((data ?? []) as ProjectPhase[])
}

type CreateBody = {
  project_id?: string
  phase_type_id?: string
  name?: string | null
  start_date?: string
  end_date?: string | null
  status?: 'planned' | 'in_progress' | 'done'
  progress_percent?: number
  sort_order?: number
  subcontractor_id?: string | null
  weight?: number | null
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as CreateBody
  if (!body.project_id) return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })
  if (!body.phase_type_id) return NextResponse.json({ error: 'Velg en fasetype' }, { status: 400 })
  if (!body.start_date) return NextResponse.json({ error: 'Startdato mangler' }, { status: 400 })
  if (body.end_date && body.end_date < body.start_date) {
    return NextResponse.json({ error: 'Sluttdato kan ikke være før startdato' }, { status: 400 })
  }
  const progress = Number(body.progress_percent ?? 0)
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    return NextResponse.json({ error: 'Fremdrift må være 0–100' }, { status: 400 })
  }

  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const phase: ProjectPhase & { created_at: string; updated_at: string } = {
    id: randomUUID(),
    project_id: body.project_id,
    phase_type_id: body.phase_type_id,
    name: body.name?.trim() || null,
    start_date: body.start_date,
    end_date: body.end_date ?? null,
    status: body.status ?? 'planned',
    progress_percent: progress,
    sort_order: Number(body.sort_order ?? 0) || 0,
    subcontractor_id: body.subcontractor_id ?? null,
    weight: body.weight != null && Number.isFinite(Number(body.weight)) && Number(body.weight) >= 0
      ? Number(body.weight)
      : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin().from('project_phases').insert(phase)
  if (error) return NextResponse.json({ error: 'Lagring feilet — er fasetypene aktivert (migrasjon 0002)?' }, { status: 500 })
  return NextResponse.json(phase, { status: 201 })
}
