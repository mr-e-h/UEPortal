import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson, getDeletedProjectIds } from '@/lib/data'
import type { ChangeOrder, Product, SubcontractorProductPrice } from '@/types'
import { getSession } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    const isSubRole = session?.role === 'sub' || session?.role === 'subcontractor'

    const params = new URL(request.url).searchParams
    const deletedProjectIds = getDeletedProjectIds()
    let orders = readJson<ChangeOrder>('change_orders.json')
      .filter((o) => o.status !== 'draft' && !deletedProjectIds.has(o.project_id))
    const projectId = params.get('project_id')
    const subcontractorId = params.get('subcontractor_id')
    const id = params.get('id')

    if (isSubRole && session?.subcontractor_id) {
      orders = orders.filter((o) => o.subcontractor_id === session.subcontractor_id)
    }
    if (id) orders = orders.filter((o) => o.id === id)
    if (projectId) orders = orders.filter((o) => o.project_id === projectId)
    if (subcontractorId) orders = orders.filter((o) => o.subcontractor_id === subcontractorId)
    return NextResponse.json(orders)
  } catch (error) {
    console.error('change-orders GET error:', error)
    return NextResponse.json([], { status: 200 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      project_id: string
      product_id: string
      subcontractor_id: string
      requested_quantity: number
      reason: string
      status?: 'pending' | 'draft'
    }

    const products = readJson<Product>('products.json')
    const prices = readJson<SubcontractorProductPrice>('subcontractor_product_prices.json')

    const product = products.find((p) => p.id === body.product_id)
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const priceEntry = prices.find(
      (p) => p.subcontractor_id === body.subcontractor_id && p.product_id === body.product_id
    )
    const costPrice = priceEntry?.cost_price ?? 0

    const totalCost = costPrice * body.requested_quantity
    const totalCustomerValue = product.customer_price * body.requested_quantity
    const profit = totalCustomerValue - totalCost

    const orders = readJson<ChangeOrder>('change_orders.json')
    const isDraft = body.status === 'draft'
    const now = new Date().toISOString()
    const newOrder: ChangeOrder = {
      id: String(Date.now()),
      project_id: body.project_id,
      product_id: body.product_id,
      subcontractor_id: body.subcontractor_id,
      requested_quantity: body.requested_quantity,
      unit: product.unit,
      cost_price_snapshot: costPrice,
      customer_price_snapshot: product.customer_price,
      total_cost: totalCost,
      total_customer_value: totalCustomerValue,
      profit,
      reason: body.reason,
      attachment_url: null,
      status: isDraft ? 'draft' : 'pending',
      submitted_at: isDraft ? null : now,
      reviewed_at: null,
      reviewed_by: null,
      admin_comment: null,
    }
    writeJson('change_orders.json', [...orders, newOrder])
    return NextResponse.json(newOrder, { status: 201 })
  } catch (error) {
    console.error('change-orders POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
