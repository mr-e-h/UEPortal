import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable, getProjectScope } from '@/lib/api-guard'
import type { Project } from '@/types'

/**
 * Whitelist of fields admins are allowed to set via PUT. Without this guard
 * the previous `{ ...projects[idx], ...body }` spread let any caller flip
 * `deleted`, `deleted_at`, the audit columns, or arbitrary unknown fields.
 */
const EDITABLE_FIELDS: (keyof Project)[] = [
  'name', 'project_number', 'order_number', 'customer', 'county',
  'status', 'start_date', 'end_date', 'planned_hours',
]

/**
 * Fetch one project by id. Used by the admin project detail page so it
 * doesn't have to download the full /api/projects list just to .find()
 * one row — which would scale with total project count instead of being
 * a constant lookup.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('projects')
    .select('*')
    .eq('id', params.id)
    .neq('deleted', true)
    .maybeSingle<Project>()
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Prosjekt ikke funnet' }, { status: 404 })

  // PM-scope gate: 404 instead of 403 so URL-tampering doesn't reveal
  // which ids exist outside the PM's portfolio.
  const scope = await getProjectScope(auth.user)
  if (scope && !scope.has(data.id)) {
    return NextResponse.json({ error: 'Prosjekt ikke funnet' }, { status: 404 })
  }

  return NextResponse.json(data)
}

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
  // planned_hours er en overstyring: null = bruk beregnet, ellers ikke-negativt tall.
  if ('planned_hours' in updates && updates.planned_hours != null) {
    const h = Number(updates.planned_hours)
    if (!Number.isFinite(h) || h < 0) {
      return NextResponse.json({ error: 'Ugyldig timeantall' }, { status: 400 })
    }
    updates.planned_hours = h
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
