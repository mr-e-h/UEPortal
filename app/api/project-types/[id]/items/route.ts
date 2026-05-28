import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { ProjectTypeChecklistItem } from '@/types'

/**
 * Manage the checklist template attached to a project type.
 *
 *   GET    → ordered list of items
 *   POST   → append a new item, auto-incrementing sort_order
 *   PUT    → replace ALL items (used by the drag-to-reorder UI; client
 *            sends the full ordered array)
 *
 * Per-item update/delete goes through PUT-with-full-array for simplicity.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('project_type_checklist_items')
    .select('*')
    .eq('project_type_id', params.id)
    .order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((data ?? []) as ProjectTypeChecklistItem[])
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { label?: string }
  const label = body.label?.trim()
  if (!label) return NextResponse.json({ error: 'Tekst er påkrevd' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const { count } = await sb
    .from('project_type_checklist_items')
    .select('id', { count: 'exact', head: true })
    .eq('project_type_id', params.id)

  const { data, error } = await sb
    .from('project_type_checklist_items')
    .insert({
      project_type_id: params.id,
      label,
      sort_order: (count ?? 0) * 10, // *10 leaves gaps for drag-to-insert later
    })
    .select()
    .maybeSingle<ProjectTypeChecklistItem>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { items?: Array<{ label: string }> }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items[] mangler' }, { status: 400 })
  }
  const cleaned = body.items.map((i) => (i.label ?? '').trim()).filter((s) => s.length > 0)

  const sb = getSupabaseAdmin()
  // Wipe + re-insert is simpler than diffing and acceptable here — the
  // checklist template is short (typically <30 items) and the page sends
  // the new list as a single transaction. Race risk is minimal because
  // only admins touch this table.
  const delErr = await sb
    .from('project_type_checklist_items')
    .delete()
    .eq('project_type_id', params.id)
  if (delErr.error) return NextResponse.json({ error: delErr.error.message }, { status: 500 })

  if (cleaned.length === 0) return NextResponse.json([])

  const rows = cleaned.map((label, idx) => ({
    project_type_id: params.id,
    label,
    sort_order: idx * 10,
  }))
  const { data, error } = await sb
    .from('project_type_checklist_items')
    .insert(rows)
    .select()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as ProjectTypeChecklistItem[])
}
