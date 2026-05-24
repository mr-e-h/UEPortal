import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { Project } from '@/types'

/**
 * Whitelist of fields admins are allowed to set via PUT. Without this guard
 * the previous `{ ...projects[idx], ...body }` spread let any caller flip
 * `deleted`, `deleted_at`, the audit columns, or arbitrary unknown fields.
 */
const EDITABLE_FIELDS: (keyof Project)[] = [
  'name', 'project_number', 'order_number', 'customer', 'county',
  'status', 'start_date', 'end_date',
]

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const denied = await ensureProjectWritable(auth.user, params.id)
  if (denied) return denied

  const body = await request.json() as Partial<Project>

  const updates: Partial<Project> = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in body) (updates as Record<string, unknown>)[field] = body[field]
  }
  if (body.status && !['active', 'completed', 'archived'].includes(body.status)) {
    return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Ingen felter å oppdatere' }, { status: 400 })
  }

  const { data, error } = await getSupabaseAdmin()
    .from('projects')
    .update(updates)
    .eq('id', params.id)
    .select()
    .maybeSingle<Project>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Prosjekt ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const denied = await ensureProjectWritable(auth.user, params.id)
  if (denied) return denied

  // Soft delete via dedicated columns — concurrent-safe update by id.
  const { error } = await getSupabaseAdmin()
    .from('projects')
    .update({ deleted: true, deleted_at: new Date().toISOString() })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ success: true })
}
