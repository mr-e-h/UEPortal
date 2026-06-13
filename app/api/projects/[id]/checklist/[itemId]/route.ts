import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth, ensureProjectWritable, userCanAccessProject } from '@/lib/api-guard'
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
    // Project access applies to EVERY role, not just admins — a PM/byggeleder
    // only on assigned projects, a sub only on linked projects. Without this a
    // sub or byggeleder could tick items on a project they aren't on by
    // guessing the item id (the .eq('project_id') below is a correctness
    // filter, not an authorization check).
    if (!(await userCanAccessProject(auth.user, params.id))) {
      return NextResponse.json({ error: 'Ingen tilgang til prosjektet' }, { status: 403 })
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
