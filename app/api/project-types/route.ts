import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { ProjectType, ProjectTypeChecklistItem } from '@/types'

/**
 * Project-type registry — admin-managed list of project categories. The
 * GET response embeds the per-type checklist template (sorted) so the
 * admin index page can render expandable cards in one round trip.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const sb = getSupabaseAdmin()
  const [typesRes, itemsRes] = await Promise.all([
    sb.from('project_types').select('*').order('name'),
    sb.from('project_type_checklist_items').select('*').order('sort_order'),
  ])
  if (typesRes.error) return NextResponse.json({ error: typesRes.error.message }, { status: 500 })
  const types = (typesRes.data ?? []) as ProjectType[]
  const items = (itemsRes.data ?? []) as ProjectTypeChecklistItem[]

  const itemsByType = new Map<string, ProjectTypeChecklistItem[]>()
  for (const it of items) {
    const arr = itemsByType.get(it.project_type_id) ?? []
    arr.push(it)
    itemsByType.set(it.project_type_id, arr)
  }

  return NextResponse.json(
    types.map((t) => ({ ...t, items: itemsByType.get(t.id) ?? [] })),
  )
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { name?: string; description?: string }
  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: 'Navn er påkrevd' }, { status: 400 })

  const { data, error } = await getSupabaseAdmin()
    .from('project_types')
    .insert({ name, description: body.description?.trim() || null })
    .select()
    .maybeSingle<ProjectType>()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'En type med dette navnet finnes allerede' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
