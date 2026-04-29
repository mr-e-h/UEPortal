import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { Product } from '@/types'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const county = searchParams.get('county')
  const includeInactive = searchParams.get('include_inactive') === 'true'

  let products = readJson<Product>('products.json')
  if (!includeInactive) products = products.filter((p) => p.active !== false)
  if (county) products = products.filter((p) => p.county === county)

  return NextResponse.json(products)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Omit<Product, 'id' | 'created_at'>
  const products = readJson<Product>('products.json')
  const newProduct: Product = {
    ...body,
    id: randomUUID(),
    customer_price: Number(body.customer_price),
    active: body.active !== false,
    created_at: new Date().toISOString(),
  }
  writeJson('products.json', [...products, newProduct])
  return NextResponse.json(newProduct, { status: 201 })
}
