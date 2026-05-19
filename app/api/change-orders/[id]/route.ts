import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import type { ChangeOrder, Product, SubcontractorProductPrice, ProjectBudgetLine } from '@/types'

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

    const body = await request.json() as {
      product_id?: string
      requested_quantity?: number
      reason?: string
      status?: 'pending' | 'draft'
    }

    const orders = await readJson<ChangeOrder>('change_orders.json')
    const idx = orders.findIndex((o) => o.id === params.id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const order = orders[idx]

    if (isSub(session)) {
      if (order.subcontractor_id !== session.subcontractor_id) {
        return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
      }
    } else if (!isAdmin(session)) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }

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
      const products = await readJson<Product>('products.json')
      const prices = await readJson<SubcontractorProductPrice>('subcontractor_product_prices.json')

      const product = products.find((p) => p.id === newProductId)
      if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

      const priceEntry = prices.find(
        (p) => p.subcontractor_id === order.subcontractor_id && p.product_id === newProductId
      )
      costPriceSnapshot = priceEntry?.cost_price ?? 0

      // Fall back to budget line snapshot if no explicit price
      if (costPriceSnapshot === 0) {
        const budgetLines = await readJson<ProjectBudgetLine>('project_budget_lines.json')
        const bl = budgetLines.find(
          (bl) =>
            bl.project_id === order.project_id &&
            bl.product_id === newProductId &&
            bl.assigned_subcontractor_id === order.subcontractor_id
        )
        if (bl && bl.subcontractor_cost_price_snapshot > 0) {
          costPriceSnapshot = bl.subcontractor_cost_price_snapshot
        }
      }

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

    await writeJson('change_orders.json', orders)
    return NextResponse.json(orders[idx])
  } catch (error) {
    console.error('change-orders PUT error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
