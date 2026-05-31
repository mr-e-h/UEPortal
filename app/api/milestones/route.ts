import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth, requireAdmin, isSub, getProjectScope, ensureProjectWritable } from '@/lib/api-guard'
import { DEFAULT_MILESTONE_COLOR } from '@/lib/milestone-colors'
import type { GanttMilestone, ProjectSubcontractor } from '@/types'

const EDITABLE_FIELDS: (keyof GanttMilestone)[] = [
  'project_id', 'subcontractor_id', 'title', 'start_date', 'end_date', 'color', 'sort_order',
]

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project_id')
  const subcontractorId = searchParams.get('subcontractor_id')

  const sb = getSupabaseAdmin()
  const query = sb.from('milestones').select('*')
  if (projectId) query.eq('project_id', projectId)
  if (subcontractorId) query.eq('subcontractor_id', subcontractorId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let milestones = (data ?? []) as GanttMilestone[]

  if (isSub(auth.user)) {
    const subId = auth.user.subcontractor_id
    if (!subId) return NextResponse.json([])
    const { data: links } = await sb
      .from('project_subcontractors')
      .select('project_id')
      .eq('subcontractor_id', subId)
    const allowedProjectIds = new Set(
      (links ?? []).map((l: Pick<ProjectSubcontractor, 'project_id'>) => l.project_id),
    )
    milestones = milestones.filter(
      (m) => allowedProjectIds.has(m.project_id)
        && (m.subcontractor_id == null || m.subcontractor_id === subId),
    )
    return NextResponse.json(milestones)
  }

  // PM scope: only see milestones for assigned projects.
  const scope = await getProjectScope(auth.user)
  if (scope) milestones = milestones.filter((m) => scope.has(m.project_id))

  return NextResponse.json(milestones)
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const body = await req.json()
  if (!body?.project_id || !body?.title || !body?.start_date || !body?.end_date) {
    return NextResponse.json({ error: 'Mangler påkrevde felter' }, { status: 400 })
  }

  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const newItem: GanttMilestone = {
    id: randomUUID(),
    project_id: body.project_id,
    subcontractor_id: body.subcontractor_id ?? null,
    title: body.title,
    start_date: body.start_date,
    end_date: body.end_date,
    color: body.color ?? DEFAULT_MILESTONE_COLOR,
    created_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin().from('milestones').insert(newItem)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newItem, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const body = await req.json() as Partial<GanttMilestone> & { id: string }
  if (!body.id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  // PM gate via the milestone's project.
  const sb = getSupabaseAdmin()
  const { data: existing } = await sb
    .from('milestones')
    .select('project_id')
    .eq('id', body.id)
    .maybeSingle<{ project_id: string }>()
  if (existing) {
    const denied = await ensureProjectWritable(auth.user, existing.project_id)
    if (denied) return denied
  }

  const updates: Partial<GanttMilestone> = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in body) (updates as Record<string, unknown>)[field] = body[field]
  }

  const { data, error } = await sb
    .from('milestones')
    .update(updates)
    .eq('id', body.id)
    .select()
    .maybeSingle<GanttMilestone>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}

// Bulk sort-order update. Could be a single SQL statement, but Supabase JS
// doesn't expose a clean WHEN/CASE upsert; we do per-row updates in parallel.
// Each update is targeted so no whole-table rewrite happens.
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const updates = await req.json() as { id: string; sort_order: number }[]
  const sb = getSupabaseAdmin()

  const ids = updates.map((u) => u.id)
  if (ids.length === 0) return NextResponse.json({ ok: true })

  // PM gate: a PM may only reorder milestones in projects they're assigned to.
  // Resolve the affected milestones to their projects and verify write access
  // on each distinct one (no-op for main/company). Without this a PM could
  // pass IDs from any project and silently reorder outside their scope.
  const { data: rows } = await sb
    .from('milestones')
    .select('project_id')
    .in('id', ids)
  const projectIds = Array.from(
    new Set((rows ?? []).map((r: Pick<GanttMilestone, 'project_id'>) => r.project_id)),
  )
  for (const pid of projectIds) {
    const denied = await ensureProjectWritable(auth.user, pid)
    if (denied) return denied
  }

  await Promise.all(updates.map(({ id, sort_order }) =>
    sb.from('milestones').update({ sort_order }).eq('id', id),
  ))
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const { data: existing } = await sb
    .from('milestones')
    .select('project_id')
    .eq('id', id)
    .maybeSingle<{ project_id: string }>()
  if (existing) {
    const denied = await ensureProjectWritable(auth.user, existing.project_id)
    if (denied) return denied
  }

  const { error } = await sb.from('milestones').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
