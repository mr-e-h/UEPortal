import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectMaterial } from '@/types'

// ─── GET /api/projects/[id]/materials ────────────────────────────────────────
// Returnerer alle materiell-rader for prosjektet, sortert på sort_order, så
// material_code. Kun tilgjengelig for admin/PL — aldri UE-siden.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('project_materials')
    .select('*')
    .eq('project_id', params.id)
    .order('sort_order', { ascending: true })
    .order('material_code', { ascending: true })

  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as ProjectMaterial[])
}

// ─── PUT /api/projects/[id]/materials ────────────────────────────────────────
// Batch-avstemming: oppdaterer actual_quantity, reconciled og comment per rad.
// Body: { rows: [{ id, actual_quantity, reconciled, comment }] }
// Hver rad verifiseres mot prosjektet (scoped update by id + project_id).

interface ReconcileRow {
  id: string
  actual_quantity: number | null
  reconciled: boolean
  comment: string
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const denied = await ensureProjectWritable(auth.user, params.id)
  if (denied) return denied

  let body: { rows?: unknown[] }
  try {
    body = await request.json() as { rows?: unknown[] }
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: 'rows må være en ikke-tom liste' }, { status: 400 })
  }

  // Validate each row structurally
  const rows: ReconcileRow[] = []
  for (const raw of body.rows) {
    const r = raw as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id) {
      return NextResponse.json({ error: 'Hver rad må ha en streng-id' }, { status: 400 })
    }
    if (typeof r.reconciled !== 'boolean') {
      return NextResponse.json({ error: `reconciled må være boolean (rad ${r.id})` }, { status: 400 })
    }
    const aq = r.actual_quantity
    if (aq !== null && aq !== undefined && typeof aq !== 'number') {
      return NextResponse.json({ error: `actual_quantity må være tall eller null (rad ${r.id})` }, { status: 400 })
    }
    rows.push({
      id: r.id,
      actual_quantity: (aq == null ? null : Number(aq)),
      reconciled: r.reconciled,
      comment: typeof r.comment === 'string' ? r.comment : '',
    })
  }

  const sb = getSupabaseAdmin()
  let updated = 0

  for (const row of rows) {
    const { error } = await sb
      .from('project_materials')
      .update({
        actual_quantity: row.actual_quantity,
        reconciled: row.reconciled,
        comment: row.comment,
      })
      // project_id scope: sikrer at klienten ikke kan skrive til rader i andre prosjekter
      .eq('id', row.id)
      .eq('project_id', params.id)

    if (error) {
      return NextResponse.json({ error: `Oppdatering feilet for rad ${row.id}` }, { status: 500 })
    }
    updated++
  }

  return NextResponse.json({ ok: true, updated })
}

// ─── POST /api/projects/[id]/materials ────────────────────────────────────────
// Legg til ÉN materiell-rad manuelt (uten Excel). Lager IKKE en ny versjon —
// versjoner er forbeholdt Excel-opplastinger; manuell tilføying er en redigering
// av den levende lista. sort_order = (max + 1) så raden havner sist.
// Body: { material_name (påkrevd), planned_quantity (påkrevd, ≥0),
//         material_code?, category?, unit?, unit_price?, supplier? }

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const denied = await ensureProjectWritable(auth.user, params.id)
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 })
  }

  const name = typeof body.material_name === 'string' ? body.material_name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Materiellnavn er påkrevd' }, { status: 400 })

  const qty = Number(body.planned_quantity)
  if (!Number.isFinite(qty) || qty < 0) {
    return NextResponse.json({ error: 'Planlagt mengde må være et tall ≥ 0' }, { status: 400 })
  }

  // Pris er valgfri (default 0). Materiell uten pris teller 0 kr i økonomien.
  const priceRaw = body.unit_price
  const price = priceRaw == null || priceRaw === '' ? 0 : Number(priceRaw)
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: 'Pris må være et tall ≥ 0' }, { status: 400 })
  }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

  const sb = getSupabaseAdmin()

  // Manuelle rader får sort_order i et eget høyt bånd (≥ 1 000 000) så de alltid
  // sorteres ETTER Excel-radene (0..N) — uavhengig av hvor mange rader en senere
  // Excel-opplasting gir. Spør kun mot manuelle rader for å finne neste plass.
  const MANUAL_BASE = 1_000_000
  const { data: top } = await sb
    .from('project_materials')
    .select('sort_order')
    .eq('project_id', params.id)
    .eq('source', 'manual')
    .order('sort_order', { ascending: false })
    .limit(1)
  const prevMax = ((top ?? [])[0]?.sort_order as number | undefined)
  const nextSort = Math.max(MANUAL_BASE - 1, prevMax ?? (MANUAL_BASE - 1)) + 1

  const row: Omit<ProjectMaterial, 'created_at'> = {
    id: randomUUID(),
    project_id: params.id,
    material_code: str(body.material_code),
    material_name: name,
    category: str(body.category),
    unit: str(body.unit),
    planned_quantity: qty,
    unit_price: price,
    supplier: str(body.supplier),
    actual_quantity: null,
    reconciled: false,
    comment: '',
    sort_order: nextSort,
    source: 'manual',
  }

  const { error } = await sb.from('project_materials').insert(row)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  return NextResponse.json({ ok: true, material: row }, { status: 201 })
}

// ─── DELETE /api/projects/[id]/materials?id=<materialId> ──────────────────────
// Sletter ÉN materiell-rad (scoped til prosjektet) — for å fjerne en feilført
// eller manuelt lagt rad. Lager ingen versjon.

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const denied = await ensureProjectWritable(auth.user, params.id)
  if (denied) return denied

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  const { error } = await getSupabaseAdmin()
    .from('project_materials')
    .delete()
    .eq('id', id)
    .eq('project_id', params.id)

  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
