import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { SubcontractorProductPrice } from '@/types'

function validatePrice(value: unknown): { ok: true; price: number } | { ok: false; error: string } {
  const n = Number(value)
  if (!Number.isFinite(n)) return { ok: false, error: 'Pris må være et tall' }
  if (n < 0) return { ok: false, error: 'Pris kan ikke være negativ' }
  return { ok: true, price: n }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const subcontractorId = new URL(request.url).searchParams.get('subcontractor_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('subcontractor_product_prices').select('*')
  if (subcontractorId) query.eq('subcontractor_id', subcontractorId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as SubcontractorProductPrice[])
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<Omit<SubcontractorProductPrice, 'id'>>
  if (!body.subcontractor_id || !body.product_id) {
    return NextResponse.json({ error: 'subcontractor_id og product_id er påkrevd' }, { status: 400 })
  }
  const v = validatePrice(body.cost_price)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  // Upsert by (subcontractor_id, product_id) — a unique index in the schema
  // makes Postgres serialize concurrent writes safely.
  const sb = getSupabaseAdmin()
  const { data: existing } = await sb
    .from('subcontractor_product_prices')
    .select('id')
    .eq('subcontractor_id', body.subcontractor_id)
    .eq('product_id', body.product_id)
    .maybeSingle<{ id: string }>()

  if (existing) {
    const { data, error } = await sb
      .from('subcontractor_product_prices')
      .update({ cost_price: v.price })
      .eq('id', existing.id)
      .select()
      .maybeSingle<SubcontractorProductPrice>()
    if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
    return NextResponse.json(data)
  }

  const newPrice: SubcontractorProductPrice = {
    id: randomUUID(),
    subcontractor_id: body.subcontractor_id,
    product_id: body.product_id,
    cost_price: v.price,
  }
  const { error } = await sb.from('subcontractor_product_prices').insert(newPrice)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newPrice, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id, cost_price } = await request.json() as { id: string; cost_price: number }
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })
  const v = validatePrice(cost_price)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const { data, error } = await getSupabaseAdmin()
    .from('subcontractor_product_prices')
    .update({ cost_price: v.price })
    .eq('id', id)
    .select()
    .maybeSingle<SubcontractorProductPrice>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}
