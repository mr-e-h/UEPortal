import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireStaff, requireAdmin } from '@/lib/api-guard'
import type { PhaseType } from '@/components/admin/FremdriftsplanClient'

/**
 * GET  /api/phase-types — aktive arbeidsfase-typer (Graving, Luftarbeid, ...).
 *      Lesbar for alt prosjektpersonell inkl. byggeleder (ingen økonomi her).
 *      Returnerer [] hvis tabellen ikke finnes ennå (0002 ikke kjørt) — samme
 *      fallback-prinsipp som fremdriftsplan-siden.
 * POST — opprett ny fasetype (admin-rollene). Typene er GLOBALE: en ny fase
 *      blir umiddelbart tilgjengelig i fasevelgeren på alle prosjekter,
 *      i porteføljefilteret og i standardfase-malene per prosjekttype.
 * PATCH — rediger fasetype (navn/farge, admin-rollene). Endringen slår
 *      umiddelbart gjennom overalt der fasen vises (alle visninger leser
 *      registeret) — også på faser som allerede ligger på prosjekter.
 * DELETE ?id= — fjern fasetype (admin-rollene). Avvises med tydelig melding
 *      hvis fasen er i bruk på prosjekter (FK er RESTRICT i DB som backstopp);
 *      mal-rader per prosjekttype ryddes automatisk (CASCADE).
 */
export async function GET() {
  const auth = await requireStaff()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('phase_types')
    .select('id, name, color, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) return NextResponse.json([])
  return NextResponse.json((data ?? []) as PhaseType[])
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { name?: string; color?: string }
  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: 'Navn er påkrevd' }, { status: 400 })
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color ?? '') ? body.color! : '#94A3B8'

  const sb = getSupabaseAdmin()
  const { data: existing } = await sb
    .from('phase_types')
    .select('id, name, is_active')
    .ilike('name', name)
    .maybeSingle<{ id: string; name: string; is_active: boolean }>()
  if (existing) {
    return NextResponse.json({ error: `Fasetypen «${existing.name}» finnes allerede` }, { status: 409 })
  }

  const { count } = await sb
    .from('phase_types')
    .select('id', { count: 'exact', head: true })

  const { data, error } = await sb
    .from('phase_types')
    .insert({ name, color, is_active: true, sort_order: ((count ?? 0) + 1) * 10 })
    .select('id, name, color, is_active, sort_order')
    .maybeSingle<PhaseType>()
  if (error || !data) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { id?: string; name?: string; color?: string }
  if (!body.id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  const updates: Record<string, string> = {}
  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: 'Navn kan ikke være tomt' }, { status: 400 })
    updates.name = name
  }
  if (body.color !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(body.color)) {
      return NextResponse.json({ error: 'Ugyldig farge' }, { status: 400 })
    }
    updates.color = body.color
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Ingenting å oppdatere' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  if (updates.name) {
    const { data: dup } = await sb
      .from('phase_types')
      .select('id, name')
      .ilike('name', updates.name)
      .neq('id', body.id)
      .maybeSingle<{ id: string; name: string }>()
    if (dup) {
      return NextResponse.json({ error: `Fasetypen «${dup.name}» finnes allerede` }, { status: 409 })
    }
  }

  const { data, error } = await sb
    .from('phase_types')
    .update(updates)
    .eq('id', body.id)
    .select('id, name, color, is_active, sort_order')
    .maybeSingle<PhaseType>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Fasen finnes ikke' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  const sb = getSupabaseAdmin()
  // Vennlig sjekk før DB-ens RESTRICT: er fasen i bruk på prosjekter?
  const { count: inUse } = await sb
    .from('project_phases')
    .select('id', { count: 'exact', head: true })
    .eq('phase_type_id', id)
  if ((inUse ?? 0) > 0) {
    return NextResponse.json(
      { error: `Fasen er i bruk på ${inUse} fase${inUse === 1 ? '' : 'r'} ute på prosjektene — slett disse først` },
      { status: 409 },
    )
  }

  const { error } = await sb.from('phase_types').delete().eq('id', id)
  // Race mot RESTRICT (fase tatt i bruk mellom sjekk og sletting) → samme melding.
  if (error) {
    return NextResponse.json(
      { error: 'Fasen er i bruk på prosjektene og kan ikke slettes' },
      { status: 409 },
    )
  }
  return NextResponse.json({ ok: true })
}
