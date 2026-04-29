import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import type { ChangeOrder, Product, SubcontractorProductPrice } from '@/types'

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json() as {
      product_id?: string
      requested_quantity?: number
      reason?: string
      status?: 'pending' | 'draft'
    }

    const orders = readJson<ChangeOrder>('change_orders.json')
    const idx = orders.findIndex((o) => o.id === params.id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const order = orders[idx]
    if (order.status !== 'draft') {
      return NextResponse.json({ error: 'Kan kun redigere kladder' }, { status: 409 })
    }

    const newProductId = body.product_id ?? order.product_id
    const newQuantity = body.requested_quantity ?? order.requested_quantity
    const newReason = body.reason ?? order.reason
    const newStatus = body.status ?? order.status

    let costPriceSnapshot = order.cost_price_snapshot
    let customerPriceSnapshot = order.customer_price_snapshot
    let unit = order.unit

    if (newProductId !== order.product_id || newQuantity !== order.requested_quantity) {
      const products = readJson<Product>('products.json')
      const prices = readJson<SubcontractorProductPrice>('subcontractor_product_prices.json')

      const product = products.find((p) => p.id === newProductId)
      if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

      const priceEntry = prices.find(
        (p) => p.subcontractor_id === order.subcontractor_id && p.product_id === newProductId
      )
      costPriceSnapshot = priceEntry?.cost_price ?? 0
      customerPriceSnapshot = product.customer_price
      unit = product.unit
    }

    const now = new Date().toISOString()
    orders[idx] = {
      ...order,
      product_id: newProductId,
      requested_quantity: newQuantity,
      unit,
      reason: newReason,
      cost_price_snapshot: costPriceSnapshot,
      customer_price_snapshot: customerPriceSnapshot,
      total_cost: costPriceSnapshot * newQuantity,
      total_customer_value: customerPriceSnapshot * newQuantity,
      profit: (customerPriceSnapshot - costPriceSnapshot) * newQuantity,
      status: newStatus,
      submitted_at: newStatus === 'pending' ? now : order.submitted_at,
    }

    writeJson('change_orders.json', orders)
    return NextResponse.json(orders[idx])
  } catch (error) {
    console.error('change-orders PUT error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
