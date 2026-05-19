import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { SubcontractorProductPrice } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const subcontractorId = new URL(request.url).searchParams.get('subcontractor_id')
  const prices = await readJson<SubcontractorProductPrice>('subcontractor_product_prices.json')
  return NextResponse.json(subcontractorId ? prices.filter((p) => p.subcontractor_id === subcontractorId) : prices)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Omit<SubcontractorProductPrice, 'id'>
  const prices = await readJson<SubcontractorProductPrice>('subcontractor_product_prices.json')
  const existing = prices.findIndex(
    (p) => p.subcontractor_id === body.subcontractor_id && p.product_id === body.product_id
  )
  if (existing !== -1) {
    prices[existing] = { ...prices[existing], cost_price: Number(body.cost_price) }
    await writeJson('subcontractor_product_prices.json', prices)
    return NextResponse.json(prices[existing])
  }
  const newPrice: SubcontractorProductPrice = { ...body, id: randomUUID(), cost_price: Number(body.cost_price) }
  await writeJson('subcontractor_product_prices.json', [...prices, newPrice])
  return NextResponse.json(newPrice, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id, cost_price } = await request.json() as { id: string; cost_price: number }
  const prices = await readJson<SubcontractorProductPrice>('subcontractor_product_prices.json')
  const idx = prices.findIndex((p) => p.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  prices[idx] = { ...prices[idx], cost_price: Number(cost_price) }
  await writeJson('subcontractor_product_prices.json', prices)
  return NextResponse.json(prices[idx])
}
