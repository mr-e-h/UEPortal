import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectChecklistItem } from '@/types'

/**
 * Per-item ops on a project's checklist.
 *
 *   PATCH { completed: boolean } → flip the checkbox. Stamps completed_at
 *   + completed_by from the session user when going to true, clears them
 *   when going back to false.
 *
 *   PATCH { label: string }      → inline rename of the item label.
 *
 *   DELETE                       → remove a single item.
 *
 * Sub-role users can tick items but cannot rename/delete (project is
 * theirs to deliver, but the punch-list structure is admin-owned).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const body = await request.json() as { completed?: boolean; label?: string }
  const isAdmin = ['main', 'project_manager', 'company'].includes(auth.user.role)

  if (body.label !== undefined) {
    if (!isAdmin) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    const denied = await ensureProjectWritable(auth.user, params.id)
    if (denied) return denied
    const label = body.label.trim()
    if (!label) return NextResponse.json({ error: 'Tekst er påkrevd' }, { status: 400 })
    const { data, error } = await getSupabaseAdmin()
      .from('project_checklist_items')
      .update({ label })
      .eq('id', params.itemId)
      .eq('project_id', params.id)
      .select()
      .maybeSingle<ProjectChecklistItem>()
    if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
    return NextResponse.json(data)
  }

  if (body.completed !== undefined) {
    // PM scope still applies for tick — a PM can only check items on
    // their assigned projects. Subs can tick on their projects too (they
    // delivered the work, so they mark it done).
    if (isAdmin) {
      const denied = await ensureProjectWritable(auth.user, params.id)
      if (denied) return denied
    }
    const updates = body.completed
      ? { completed_at: new Date().toISOString(), completed_by: auth.user.full_name }
      : { completed_at: null, completed_by: null }
    const { data, error } = await getSupabaseAdmin()
      .from('project_checklist_items')
      .update(updates)
      .eq('id', params.itemId)
      .eq('project_id', params.id)
      .select()
      .maybeSingle<ProjectChecklistItem>()
    if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: 'Ingen endringer' }, { status: 400 })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!['main', 'project_manager', 'company'].includes(auth.user.role)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }
  const denied = await ensureProjectWritable(auth.user, params.id)
  if (denied) return denied

  const { error, count } = await getSupabaseAdmin()
    .from('project_checklist_items')
    .delete({ count: 'exact' })
    .eq('id', params.itemId)
    .eq('project_id', params.id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
