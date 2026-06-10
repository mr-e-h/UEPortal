import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, requireAuth, canSeeCustomerEconomics } from '@/lib/api-guard'
import type { Product } from '@/types'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const county = searchParams.get('county')
  const includeInactive = searchParams.get('include_inactive') === 'true'

  const sb = getSupabaseAdmin()
  const query = sb.from('products').select('*')
  if (!includeInactive) query.neq('active', false)
  if (county) query.eq('county', county)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  const products = (data ?? []) as Product[]

  // Read-mostly catalog — let the browser cache for 30s and serve stale
  // for another 60s while it refetches in background. `private` because
  // sub-role users get a stripped response (customer_price hidden).
  const headers = { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' }

  // UE and byggeleder never see customer_price (MinUE's selling price).
  // canSeeCustomerEconomics is the explicit economy gate: true only for
  // main / company / project_manager — identical output for sub as before.
  if (!canSeeCustomerEconomics(auth.user)) {
    return NextResponse.json(products.map((p) => ({ ...p, customer_price: 0 })), { headers })
  }
  return NextResponse.json(products, { headers })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<Omit<Product, 'id' | 'created_at'>>
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Navn er påkrevd' }, { status: 400 })
  }
  const price = Number(body.customer_price)
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: 'Pris må være et ikke-negativt tall' }, { status: 400 })
  }

  const newProduct: Product = {
    id: randomUUID(),
    name: body.name.trim(),
    description: body.description ?? '',
    unit: body.unit ?? 'stk',
    county: body.county ?? '',
    customer_price: price,
    active: body.active !== false,
    created_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin().from('products').insert(newProduct)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newProduct, { status: 201 })
}
