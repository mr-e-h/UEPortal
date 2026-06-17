import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectChecklistItem } from '@/types'

/**
 * Legg til ETT ad-hoc-punkt (eller én seksjon) på prosjektets sjekkliste — uten
 * å regenerere fra malen (som ville nullstilt avhukinger). Strukturen eies av
 * admin, så kun main/PL/company på skrivbare prosjekter. Avhuking (subs også)
 * går via /checklist/[itemId].
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!['main', 'project_manager', 'company'].includes(auth.user.role)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }
  const denied = await ensureProjectWritable(auth.user, params.id)
  if (denied) return denied

  const body = await request.json() as { label?: string; is_section?: boolean }
  const label = body.label?.trim()
  if (!label) return NextResponse.json({ error: 'Tekst er påkrevd' }, { status: 400 })

  const sb = getSupabaseAdmin()
  // Neste sort_order = etter siste eksisterende rad (legges nederst).
  const { data: last } = await sb
    .from('project_checklist_items')
    .select('sort_order')
    .eq('project_id', params.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>()
  const nextOrder = (last?.sort_order ?? -10) + 10

  const { data, error } = await sb
    .from('project_checklist_items')
    .insert({
      project_id: params.id,
      label,
      is_section: !!body.is_section,
      sort_order: nextOrder,
      completed_at: null,
      completed_by: null,
    })
    .select()
    .maybeSingle<ProjectChecklistItem>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
