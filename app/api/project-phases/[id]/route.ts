import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireStaff, ensureProjectWritable, isAdmin } from '@/lib/api-guard'
import type { ProjectPhase } from '@/components/admin/FremdriftsplanClient'

/**
 * PATCH /api/project-phases/[id] — oppdater en fase.
 *   main/company/PL : alle felter (på skrivbare prosjekter)
 *   byggeleder      : KUN status + progress_percent (operativ oppfølging på
 *                     tildelte prosjekter) — øvrige felter avvises.
 * DELETE — kun ADMIN_ROLES. Faser er planleggingsrader (ingen økonomi/audit-
 * historikk knyttet til dem), så hard delete er trygt.
 */

type PatchBody = {
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

const STATUSES = ['planned', 'in_progress', 'done'] as const

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireStaff()
  if (!auth.ok) return auth.response

  const sb = getSupabaseAdmin()
  const { data: phase } = await sb
    .from('project_phases')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<ProjectPhase>()
  if (!phase) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  // Skrivetilgang til prosjektet (PL-scope OG byggeleder-scope håndheves her —
  // ensureProjectWritable bruker getProjectScope som dekker begge roller).
  const denied = await ensureProjectWritable(auth.user, phase.project_id)
  if (denied) return denied

  const body = await request.json() as PatchBody
  const userIsAdmin = isAdmin(auth.user)

  // Byggeleder: kun operative felter.
  if (!userIsAdmin) {
    const sentKeys = Object.keys(body)
    const allowed = new Set(['status', 'progress_percent'])
    const illegal = sentKeys.filter((k) => !allowed.has(k))
    if (illegal.length > 0) {
      return NextResponse.json(
        { error: 'Byggeleder kan kun oppdatere status og fremdrift' },
        { status: 403 },
      )
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
    updates.status = body.status
  }
  if (body.progress_percent !== undefined) {
    const p = Number(body.progress_percent)
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      return NextResponse.json({ error: 'Fremdrift må være 0–100' }, { status: 400 })
    }
    updates.progress_percent = p
  }
  if (userIsAdmin) {
    if (body.phase_type_id !== undefined) updates.phase_type_id = body.phase_type_id
    if (body.name !== undefined) updates.name = body.name?.trim() || null
    if (body.start_date !== undefined) updates.start_date = body.start_date
    if (body.end_date !== undefined) updates.end_date = body.end_date
    if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order) || 0
    if (body.subcontractor_id !== undefined) updates.subcontractor_id = body.subcontractor_id || null
    if (body.weight !== undefined) {
      if (body.weight === null) {
        updates.weight = null
      } else {
        const w = Number(body.weight)
        if (!Number.isFinite(w) || w < 0) {
          return NextResponse.json({ error: 'Vekt må være 0 eller mer' }, { status: 400 })
        }
        updates.weight = w
      }
    }
    const newStart = (updates.start_date as string | undefined) ?? phase.start_date
    const newEnd = updates.end_date !== undefined ? (updates.end_date as string | null) : phase.end_date
    if (newEnd && newEnd < newStart) {
      return NextResponse.json({ error: 'Sluttdato kan ikke være før startdato' }, { status: 400 })
    }
  }

  const { data, error } = await sb
    .from('project_phases')
    .update(updates)
    .eq('id', params.id)
    .select()
    .maybeSingle<ProjectPhase>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireStaff()
  if (!auth.ok) return auth.response
  // Sletting er forbeholdt admin-rollene — byggeleder følger opp, rydder ikke.
  if (!isAdmin(auth.user)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const sb = getSupabaseAdmin()
  const { data: phase } = await sb
    .from('project_phases')
    .select('project_id')
    .eq('id', params.id)
    .maybeSingle<{ project_id: string }>()
  if (!phase) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  const denied = await ensureProjectWritable(auth.user, phase.project_id)
  if (denied) return denied

  const { error } = await sb.from('project_phases').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
