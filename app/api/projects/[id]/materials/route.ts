import { NextRequest, NextResponse } from 'next/server'
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
