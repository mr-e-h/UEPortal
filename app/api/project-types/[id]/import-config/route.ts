import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { ImportColumnMap } from '@/types'

/**
 * Excel-import-oppsettet for en prosjekttype (kolonne-mapping). null = bruk
 * standardoppsettet. GET → { import_config }, PUT → lagre/nullstille.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('project_types')
    .select('import_config')
    .eq('id', params.id)
    .maybeSingle<{ import_config: ImportColumnMap | null }>()
  if (error) return NextResponse.json({ import_config: null })
  return NextResponse.json({ import_config: data?.import_config ?? null })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { import_config: ImportColumnMap | null }
  const cfg = body.import_config

  if (cfg !== null) {
    const numOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))
    if (typeof cfg !== 'object' || !cfg) {
      return NextResponse.json({ error: 'Ugyldig oppsett' }, { status: 400 })
    }
    if (!Number.isFinite(cfg.startRow) || cfg.startRow < 1) {
      return NextResponse.json({ error: 'Startrad må være 1 eller mer' }, { status: 400 })
    }
    for (const f of ['code', 'name', 'price', 'qty', 'fixedPrice'] as const) {
      if (!numOrNull(cfg[f])) return NextResponse.json({ error: `Ugyldig kolonne for ${f}` }, { status: 400 })
    }
  }

  const { error } = await getSupabaseAdmin()
    .from('project_types')
    .update({ import_config: cfg })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
