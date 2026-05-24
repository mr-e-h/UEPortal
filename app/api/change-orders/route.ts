import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getDeletedProjectIds } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isSub, getProjectScope, ensureProjectWritable } from '@/lib/api-guard'
import type { ChangeOrder, Product, SubcontractorProductPrice, ProjectBudgetLine } from '@/types'

function stripForUE<T extends ChangeOrder>(o: T) {
  const { customer_price_snapshot: _cp, total_customer_value: _tcv, profit: _p, ...rest } = o
  return rest
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
    const userIsSub = isSub(session)

    const params = new URL(request.url).searchParams
    const projectId = params.get('project_id')
    const subcontractorId = params.get('subcontractor_id')
    const id = params.get('id')

    const sb = getSupabaseAdmin()
    const query = sb.from('change_orders').select('*').neq('status', 'draft')
    if (userIsSub) {
      if (!session.subcontractor_id) return NextResponse.json([])
      query.eq('subcontractor_id', session.subcontractor_id)
    }
    if (id) query.eq('id', id)
    if (projectId) query.eq('project_id', projectId)
    if (subcontractorId) query.eq('subcontractor_id', subcontractorId)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
    let orders = (data ?? []) as ChangeOrder[]

    const deletedProjectIds = await getDeletedProjectIds()
    orders = orders.filter((o) => !deletedProjectIds.has(o.project_id))

    if (userIsSub) return NextResponse.json(orders.map(stripForUE))

    // PM scope: only see COs for assigned projects.
    const scope = await getProjectScope(session)
    if (scope) orders = orders.filter((o) => scope.has(o.project_id))
    return NextResponse.json(orders)
  } catch (error) {
    console.error('change-orders GET error:', error)
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 })
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

    const userIsSub = isSub(session)
    if (userIsSub && session.subcontractor_id !== body.subcontractor_id) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }
    if (!userIsSub && !['main', 'project_manager', 'company'].includes(session.role)) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }

    const qty = Number(body.requested_quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: 'Mengde må være et positivt tall' }, { status: 400 })
    }

    // PM write-side gate. UE writes are already scoped via subcontractor_id check above.
    if (!userIsSub) {
      const denied = await ensureProjectWritable(session, body.project_id)
      if (denied) return denied
    }

    const sb = getSupabaseAdmin()
    // Three targeted lookups instead of full-table reads.
    const [productRes, priceRes, blRes] = await Promise.all([
      sb.from('products').select('customer_price, unit').eq('id', body.product_id).maybeSingle<Pick<Product, 'customer_price' | 'unit'>>(),
      sb.from('subcontractor_product_prices').select('cost_price')
        .eq('subcontractor_id', body.subcontractor_id)
        .eq('product_id', body.product_id)
        .maybeSingle<Pick<SubcontractorProductPrice, 'cost_price'>>(),
      sb.from('project_budget_lines').select('subcontractor_cost_price_snapshot')
        .eq('project_id', body.project_id)
        .eq('product_id', body.product_id)
        .eq('assigned_subcontractor_id', body.subcontractor_id)
        .maybeSingle<Pick<ProjectBudgetLine, 'subcontractor_cost_price_snapshot'>>(),
    ])

    if (!productRes.data) return NextResponse.json({ error: 'Produkt ikke funnet' }, { status: 404 })
    const product = productRes.data

    let costPrice = priceRes.data?.cost_price ?? 0
    if (costPrice === 0 && blRes.data && blRes.data.subcontractor_cost_price_snapshot > 0) {
      // Fall back to the snapshot from the budget line — the line was assigned
      // with a known price even if the master price list is missing now.
      costPrice = blRes.data.subcontractor_cost_price_snapshot
    }

    const totalCost = costPrice * qty
    const totalCustomerValue = product.customer_price * qty
    const profit = totalCustomerValue - totalCost

    const isDraft = body.status === 'draft'
    const now = new Date().toISOString()
    const newOrder: ChangeOrder = {
      id: randomUUID(),
      project_id: body.project_id,
      product_id: body.product_id,
      subcontractor_id: body.subcontractor_id,
      requested_quantity: qty,
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
      created_at: now,
    }
    const { error } = await sb.from('change_orders').insert(newOrder)
    if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

    return NextResponse.json(userIsSub ? stripForUE(newOrder) : newOrder, { status: 201 })
  } catch (error) {
    console.error('change-orders POST error:', error)
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 })
  }
}
