import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { Product, SubcontractorProductPrice } from '@/types'

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const products = readJson<Product>('products.json')
  const idx = products.findIndex((p) => p.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  const body = await request.json() as Partial<Product>
  products[idx] = {
    ...products[idx],
    ...body,
    id: params.id, // prevent id change
    customer_price: body.customer_price !== undefined ? Number(body.customer_price) : products[idx].customer_price,
  }
  writeJson('products.json', products)
  return NextResponse.json(products[idx])
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const products = readJson<Product>('products.json')
  if (!products.find((p) => p.id === params.id)) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  }

  writeJson('products.json', products.filter((p) => p.id !== params.id))

  const prices = readJson<SubcontractorProductPrice>('subcontractor_product_prices.json')
  writeJson('subcontractor_product_prices.json', prices.filter((p) => p.product_id !== params.id))

  return NextResponse.json({ ok: true })
}
