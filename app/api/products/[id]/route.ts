import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { Product } from '@/types'

const EDITABLE_FIELDS: (keyof Product)[] = [
  'name', 'description', 'unit', 'county', 'customer_price', 'active',
]

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<Product>
  const updates: Partial<Product> = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in body) (updates as Record<string, unknown>)[field] = body[field]
  }
  if (updates.customer_price !== undefined) {
    const n = Number(updates.customer_price)
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'Ugyldig pris' }, { status: 400 })
    }
    updates.customer_price = n
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Ingen felter å oppdatere' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('products')
    .update(updates)
    .eq('id', params.id)
    .select()
    .maybeSingle<Product>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  // Cascade: drop the per-UE prices first (FK fan-out), then the product.
  // Atomic enough for this scale; concurrent edits to the same product row
  // would still be a problem but at least we no longer rewrite the whole table.
  const sb = getSupabaseAdmin()
  const { error: priceErr } = await sb
    .from('subcontractor_product_prices')
    .delete()
    .eq('product_id', params.id)
  if (priceErr) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })

  const { error: prodErr } = await sb.from('products').delete().eq('id', params.id)
  if (prodErr) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
