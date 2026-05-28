import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { ProjectType } from '@/types'

/**
 * Rename / re-describe / delete a project type. Deleting cascades the
 * template items (FK ON DELETE CASCADE) but leaves projects that were
 * tagged with this type pointing at NULL — they keep their copied
 * checklist instances since those live on project_checklist_items.
 */

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const body = await request.json() as { name?: string; description?: string | null }
  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string') {
    const n = body.name.trim()
    if (!n) return NextResponse.json({ error: 'Navn er påkrevd' }, { status: 400 })
    updates.name = n
  }
  if (body.description !== undefined) {
    updates.description = body.description?.toString().trim() || null
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Ingen endringer' }, { status: 400 })
  }

  const { data, error } = await getSupabaseAdmin()
    .from('project_types')
    .update(updates)
    .eq('id', params.id)
    .select()
    .maybeSingle<ProjectType>()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'En type med dette navnet finnes allerede' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { error, count } = await getSupabaseAdmin()
    .from('project_types')
    .delete({ count: 'exact' })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
