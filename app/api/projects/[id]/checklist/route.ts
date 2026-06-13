import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth, ensureProjectWritable, userCanAccessProject } from '@/lib/api-guard'
import type { ProjectChecklistItem, Project } from '@/types'

/**
 * Per-project checklist instance.
 *
 *   GET    → ordered list of items for THIS project (sub-readable so the
 *            UE can see what's on the punch-list; tick is admin-only)
 *   POST   → instantiate from the linked project_type's template
 *            (replaces existing items if the project already had one —
 *            client gates this with a confirm)
 *   PUT    → replace items wholesale (drag-to-reorder / inline edits)
 *
 * The /checklist/[itemId] route handles per-item tick/untick.
 */

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  // Scope gate: PM/byggeleder only their assigned projects, a sub only projects
  // they're linked to. Without this any authenticated user could read any
  // project's punch-list by guessing the id.
  if (!(await userCanAccessProject(auth.user, params.id))) {
    return NextResponse.json({ error: 'Ingen tilgang til prosjektet' }, { status: 403 })
  }

  const { data, error } = await getSupabaseAdmin()
    .from('project_checklist_items')
    .select('*')
    .eq('project_id', params.id)
    .order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((data ?? []) as ProjectChecklistItem[])
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  // Admin (main/PM/company) only — UEs cannot regenerate a checklist.
  if (!['main', 'project_manager', 'company'].includes(auth.user.role)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }
  const denied = await ensureProjectWritable(auth.user, params.id)
  if (denied) return denied

  const sb = getSupabaseAdmin()
  // Look up the project's type so we know what template to copy.
  const { data: proj } = await sb
    .from('projects')
    .select('project_type_id')
    .eq('id', params.id)
    .maybeSingle<Pick<Project, 'project_type_id'>>()
  if (!proj || !proj.project_type_id) {
    return NextResponse.json(
      { error: 'Prosjektet har ingen type — sett type først for å generere sjekkliste' },
      { status: 400 },
    )
  }

  const { data: template, error: tplErr } = await sb
    .from('project_type_checklist_items')
    .select('*')
    .eq('project_type_id', proj.project_type_id)
    .order('sort_order')
  if (tplErr) return NextResponse.json({ error: tplErr.message }, { status: 500 })

  // Wipe existing items first — re-running the generator on a project that
  // already has a checklist replaces it with a fresh copy. Caller gates
  // this with a confirm to avoid surprising the user.
  const delErr = await sb.from('project_checklist_items').delete().eq('project_id', params.id)
  if (delErr.error) return NextResponse.json({ error: delErr.error.message }, { status: 500 })

  if (!template || template.length === 0) return NextResponse.json([])
  const rows = template.map((t, idx) => ({
    project_id: params.id,
    label: t.label,
    sort_order: idx * 10,
    completed_at: null,
    completed_by: null,
  }))
  const { data: inserted, error } = await sb
    .from('project_checklist_items')
    .insert(rows)
    .select()
  if (error) return NextResponse.json({ error: 'Generering feilet' }, { status: 500 })
  return NextResponse.json((inserted ?? []) as ProjectChecklistItem[], { status: 201 })
}
