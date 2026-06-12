import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { Project } from '@/types'
import type { PhaseType } from '@/components/admin/FremdriftsplanClient'

/**
 * POST /api/project-phases/apply-standard { project_id }
 *
 * Oppretter standardfasene for prosjektet i project_phases:
 *   - Prosjekttypens mal (project_type_default_phases) hvis den finnes,
 *     ellers ALLE aktive fasetyper («alle er standard enn så lenge»).
 *   - Fasetyper som allerede har en fase på prosjektet hoppes over —
 *     handlingen er additiv og trygg å trykke flere ganger.
 *   - Datoer: prosjektets periode (justeres etterpå per fase).
 *
 * Kun ADMIN_ROLES (samme som fase-opprettelse ellers) + skrivbart prosjekt.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { project_id?: string }
  if (!body.project_id) return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })

  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const sb = getSupabaseAdmin()
  const { data: project } = await sb
    .from('projects')
    .select('id, start_date, end_date, project_type_id')
    .eq('id', body.project_id)
    .maybeSingle<Pick<Project, 'id' | 'start_date' | 'end_date' | 'project_type_id'>>()
  if (!project) return NextResponse.json({ error: 'Prosjektet finnes ikke' }, { status: 404 })

  const { data: typesData, error: typesErr } = await sb
    .from('phase_types')
    .select('id, name, color, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order')
  if (typesErr) {
    return NextResponse.json({ error: 'Fasetyper er ikke aktivert ennå (migrasjon 0002).' }, { status: 500 })
  }
  let standardTypes = (typesData ?? []) as PhaseType[]

  // Prosjekttypens mal — hvis 0003 er kjørt OG typen har en konfigurasjon.
  // Ellers gjelder «alle aktive fasetyper er standard».
  if (project.project_type_id) {
    const { data: cfg, error: cfgErr } = await sb
      .from('project_type_default_phases')
      .select('phase_type_id, sort_order')
      .eq('project_type_id', project.project_type_id)
      .order('sort_order')
    if (!cfgErr && cfg && cfg.length > 0) {
      const order = new Map(cfg.map((r, i) => [r.phase_type_id as string, i]))
      standardTypes = standardTypes
        .filter((t) => order.has(t.id))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    }
  }

  // Hopp over fasetyper som allerede er i bruk på prosjektet.
  const { data: existing } = await sb
    .from('project_phases')
    .select('phase_type_id')
    .eq('project_id', body.project_id)
  const used = new Set((existing ?? []).map((r) => r.phase_type_id as string))
  const toCreate = standardTypes.filter((t) => !used.has(t.id))

  if (toCreate.length === 0) {
    return NextResponse.json({ created: 0, skipped: standardTypes.length })
  }

  const now = new Date().toISOString()
  const rows = toCreate.map((t, i) => ({
    id: randomUUID(),
    project_id: body.project_id,
    phase_type_id: t.id,
    name: null,
    start_date: project.start_date,
    end_date: project.end_date,
    status: 'planned' as const,
    progress_percent: 0,
    sort_order: i * 10,
    created_at: now,
    updated_at: now,
  }))
  const { error: insErr } = await sb.from('project_phases').insert(rows)
  if (insErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  return NextResponse.json({ created: rows.length, skipped: standardTypes.length - rows.length })
}
