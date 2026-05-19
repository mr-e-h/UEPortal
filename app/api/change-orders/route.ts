import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson, getDeletedProjectIds } from '@/lib/data'
import type { ChangeOrder, Product, SubcontractorProductPrice, ProjectBudgetLine } from '@/types'
import { getSession } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
    const isSubRole = session.role === 'sub' || session.role === 'subcontractor'

    const params = new URL(request.url).searchParams
    const deletedProjectIds = getDeletedProjectIds()
    let orders = readJson<ChangeOrder>('change_orders.json')
      .filter((o) => o.status !== 'draft' && !deletedProjectIds.has(o.project_id))
    const projectId = params.get('project_id')
    const subcontractorId = params.get('subcontractor_id')
    const id = params.get('id')

    if (isSubRole) {
      if (!session.subcontractor_id) return NextResponse.json([])
      orders = orders.filter((o) => o.subcontractor_id === session.subcontractor_id)
    }
    if (id) orders = orders.filter((o) => o.id === id)
    if (projectId) orders = orders.filter((o) => o.project_id === projectId)
    if (subcontractorId) orders = orders.filter((o) => o.subcontractor_id === subcontractorId)

    if (isSubRole) {
      const safe = orders.map(
        ({ customer_price_snapshot: _cp, total_customer_value: _tcv, profit: _p, ...rest }) => rest
      )
      return NextResponse.json(safe)
    }
    return NextResponse.json(orders)
  } catch (error) {
    console.error('change-orders GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

    const body = await request.json() as {
      project_id: string
      product_id: string
      subcontractor_id: string
      requested_quantity: number
      reason: string
      status?: 'pending' | 'draft'
    }

    const isSubRole = session.role === 'sub' || session.role === 'subcontractor'
    if (isSubRole && session.subcontractor_id !== body.subcontractor_id) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }
    if (!isSubRole && !['main', 'project_manager', 'company'].includes(session.role)) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }

    const products = readJson<Product>('products.json')
    const prices = readJson<SubcontractorProductPrice>('subcontractor_product_prices.json')

    const product = products.find((p) => p.id === body.product_id)
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const priceEntry = prices.find(
      (p) => p.subcontractor_id === body.subcontractor_id && p.product_id === body.product_id
    )
    let costPrice = priceEntry?.cost_price ?? 0

    // Fall back to the snapshot price from the assigned budget line if no explicit price
    if (costPrice === 0) {
      const budgetLines = readJson<ProjectBudgetLine>('project_budget_lines.json')
      const bl = budgetLines.find(
        (bl) =>
          bl.project_id === body.project_id &&
          bl.product_id === body.product_id &&
          bl.assigned_subcontractor_id === body.subcontractor_id
      )
      if (bl && bl.subcontractor_cost_price_snapshot > 0) {
        costPrice = bl.subcontractor_cost_price_snapshot
      }
    }

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
