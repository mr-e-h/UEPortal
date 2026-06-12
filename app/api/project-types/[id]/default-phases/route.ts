import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'

/**
 * Standardfaser-malen for en prosjekttype (speiler sjekkliste-malmønsteret).
 *
 *   GET → { configured: boolean, phase_type_ids: string[] }
 *         configured=false betyr «ingen egen mal» → alle aktive fasetyper
 *         er standard. Tåler at tabellen mangler (migrasjon 0003 ikke kjørt).
 *   PUT → { phase_type_ids: string[] } — erstatter hele malen. Tom liste
 *         sletter malen (= tilbake til «alle er standard»).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('project_type_default_phases')
    .select('phase_type_id, sort_order')
    .eq('project_type_id', params.id)
    .order('sort_order')
  // Tabell mangler (0003 ikke kjørt) → ingen mal, alle fasetyper er standard.
  if (error) return NextResponse.json({ configured: false, phase_type_ids: [] })

  const ids = (data ?? []).map((r) => r.phase_type_id as string)
  return NextResponse.json({ configured: ids.length > 0, phase_type_ids: ids })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { phase_type_ids?: string[] }
  const ids = Array.isArray(body.phase_type_ids) ? body.phase_type_ids : null
  if (!ids) return NextResponse.json({ error: 'phase_type_ids mangler' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const { error: delErr } = await sb
    .from('project_type_default_phases')
    .delete()
    .eq('project_type_id', params.id)
  if (delErr) {
    return NextResponse.json(
      { error: 'Standardfaser er ikke aktivert ennå (migrasjon 0003 må kjøres).' },
      { status: 500 },
    )
  }

  if (ids.length > 0) {
    // Dropp ids som ikke (lenger) finnes i fase-registeret — en åpen fane
    // kan ha utdaterte chips, og det skal ikke velte hele lagringen (FK).
    const { data: validRows } = await sb
      .from('phase_types')
      .select('id')
      .in('id', ids)
    const valid = new Set((validRows ?? []).map((r) => r.id as string))
    const keptIds = ids.filter((id) => valid.has(id))
    if (keptIds.length === 0) {
      return NextResponse.json(
        { error: 'Ingen av de valgte fasene finnes lenger — last siden på nytt' },
        { status: 409 },
      )
    }

    const rows = keptIds.map((phaseTypeId, i) => ({
      project_type_id: params.id,
      phase_type_id: phaseTypeId,
      sort_order: i * 10,
    }))
    const { error: insErr } = await sb.from('project_type_default_phases').insert(rows)
    if (insErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
    return NextResponse.json({ ok: true, configured: true, dropped: ids.length - keptIds.length })
  }

  return NextResponse.json({ ok: true, configured: false })
}
