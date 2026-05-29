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
      solution?: string
      em_type: 'economic' | 'spec_deviation' | 'time'
      status?: 'pending' | 'draft'
    }

    if (!body.em_type || !['economic', 'spec_deviation', 'time'].includes(body.em_type)) {
      return NextResponse.json({ error: 'Type er påkrevd (Økonomisk, Avvik kravspec eller Tid)' }, { status: 400 })
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

    // Closed-project gate. Same idea as on weekly_reports — once the
    // project is anything other than 'active', no new EMer can be filed
    // until admin re-opens it.
    const { data: proj } = await sb
      .from('projects')
      .select('status, deleted')
      .eq('id', body.project_id)
      .maybeSingle<{ status: string; deleted: boolean | null }>()
    if (!proj || proj.deleted) {
      return NextResponse.json({ error: 'Prosjektet finnes ikke' }, { status: 404 })
    }
    if (proj.status !== 'active') {
      return NextResponse.json(
        { error: 'Prosjektet er lukket — admin må åpne det igjen for å sende endringsmeldinger' },
        { status: 409 },
      )
    }

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
    // change_order_number er utelatt her — Postgres-trigger
    // assign_change_order_number() tildeler neste ledige nummer i prosjektets
    // serie. Vi leser det tilbake via .select() etter insert.
    const newOrderInsert: Omit<ChangeOrder, 'change_order_number'> = {
      id: randomUUID(),
      em_type: body.em_type,
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
      solution: body.solution ?? '',
      attachment_url: null,
      status: isDraft ? 'draft' : 'pending',
      submitted_at: isDraft ? null : now,
      submitted_by: session.full_name,
      reviewed_at: null,
      reviewed_by: null,
      admin_comment: null,
      created_at: now,
      sent_to_customer_at: null,
    }
    const { data: inserted, error } = await sb
      .from('change_orders')
      .insert(newOrderInsert)
      .select('*')
      .single<ChangeOrder>()
    if (error || !inserted) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
    const newOrder = inserted

    // Also write the first line into change_order_lines — admin can later
    // add more lines via the edit form; that table is the source of truth
    // for product/qty/snapshots while change_orders caches the rollup.
    const firstLine = {
      id: randomUUID(),
      change_order_id: newOrder.id,
      product_id: newOrder.product_id,
      requested_quantity: newOrder.requested_quantity,
      unit: newOrder.unit,
      cost_price_snapshot: newOrder.cost_price_snapshot,
      customer_price_snapshot: newOrder.customer_price_snapshot,
      sort_order: 0,
    }
    await sb.from('change_order_lines').insert(firstLine)

    // Bevar ORIGINAL innsending som en activity_log-rad. Senere
    // admin-redigeringer skriver 'edited'-rader med før/etter, men
    // denne 'submitted'-raden er sannheten om hvordan EMen så ut
    // ved første innsending. VersionDiffModal kan rendre den som
    // "Opprinnelig innsending" uavhengig av hvor mange edits som
    // har skjedd etter. Drafts (isDraft=true) får IKKE submitted-rad
    // — den skrives først ved 'pending'-overgang for å unngå at
    // halvferdig kladd-innhold blir tatt som "original".
    if (!isDraft) {
      await sb.from('activity_log').insert({
        id: randomUUID(),
        entity_type: 'change_order',
        entity_id: newOrder.id,
        action: 'submitted',
        actor: session.full_name,
        created_at: now,
        metadata: {
          after: {
            change_order: {
              em_type: newOrder.em_type,
              status: newOrder.status,
              product_id: newOrder.product_id,
              requested_quantity: newOrder.requested_quantity,
              unit: newOrder.unit,
              reason: newOrder.reason,
              solution: newOrder.solution,
              attachment_url: newOrder.attachment_url,
              cost_price_snapshot: newOrder.cost_price_snapshot,
              customer_price_snapshot: newOrder.customer_price_snapshot,
              total_cost: newOrder.total_cost,
              total_customer_value: newOrder.total_customer_value,
              profit: newOrder.profit,
              submitted_by: newOrder.submitted_by,
              submitted_at: newOrder.submitted_at,
              change_order_number: newOrder.change_order_number,
            },
            lines: [{
              product_id: firstLine.product_id,
              requested_quantity: firstLine.requested_quantity,
              unit: firstLine.unit,
              cost_price_snapshot: firstLine.cost_price_snapshot,
              customer_price_snapshot: firstLine.customer_price_snapshot,
              sort_order: firstLine.sort_order,
            }],
          },
        },
      })
    }

    return NextResponse.json(userIsSub ? stripForUE(newOrder) : newOrder, { status: 201 })
  } catch (error) {
    console.error('change-orders POST error:', error)
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 })
  }
}
