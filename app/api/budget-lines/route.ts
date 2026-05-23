import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getDeletedProjectIds } from '@/lib/data'
import { requireAuth, requireAdmin, isSub } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ProjectBudgetLine, Product, SubcontractorProductPrice, ProjectSubcontractor } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const params = new URL(request.url).searchParams
  const projectId = params.get('project_id')
  const subcontractorId = params.get('subcontractor_id')

  const sb = getSupabaseAdmin()
  const query = sb.from('project_budget_lines').select('*')
  if (projectId) query.eq('project_id', projectId)
  if (subcontractorId) query.eq('assigned_subcontractor_id', subcontractorId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let lines = (data ?? []) as ProjectBudgetLine[]

  const deletedProjectIds = await getDeletedProjectIds()
  lines = lines.filter((l) => !deletedProjectIds.has(l.project_id))

  if (isSub(auth.user)) {
    const subId = auth.user.subcontractor_id
    if (!subId) return NextResponse.json([])
    const { data: links } = await sb
      .from('project_subcontractors')
      .select('project_id')
      .eq('subcontractor_id', subId)
    const allowedProjectIds = new Set(
      ((links ?? []) as Pick<ProjectSubcontractor, 'project_id'>[]).map((l) => l.project_id),
    )
    lines = lines.filter(
      (l) => l.assigned_subcontractor_id === subId
        && allowedProjectIds.has(l.project_id)
        && (l.line_type === 'subcontractor_work' || l.line_type == null),
    )
    // Strip customer_price_snapshot — UE must never see Netel's selling price.
    return NextResponse.json(lines.map((l) => ({ ...l, customer_price_snapshot: 0 })))
  }

  return NextResponse.json(lines)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    project_id: string
    product_id: string
    budget_quantity: number
    line_type?: string
  }
  const qty = Number(body.budget_quantity)
  if (!Number.isFinite(qty) || qty < 0) {
    return NextResponse.json({ error: 'Mengde må være et ikke-negativt tall' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const { data: product } = await sb
    .from('products')
    .select('customer_price')
    .eq('id', body.product_id)
    .maybeSingle<Pick<Product, 'customer_price'>>()
  if (!product) return NextResponse.json({ error: 'Produkt ikke funnet' }, { status: 404 })

  const newLine: ProjectBudgetLine = {
    id: randomUUID(),
    project_id: body.project_id,
    product_id: body.product_id,
    budget_quantity: qty,
    customer_price_snapshot: product.customer_price,
    assigned_subcontractor_id: null,
    subcontractor_cost_price_snapshot: 0,
    line_type: (body.line_type as ProjectBudgetLine['line_type']) ?? 'subcontractor_work',
  }
  const { error } = await sb.from('project_budget_lines').insert(newLine)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newLine, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    id: string
    assigned_subcontractor_id?: string | null
    line_type?: string
  }
  if (!body.id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const { data: line, error: readErr } = await sb
    .from('project_budget_lines')
    .select('*')
    .eq('id', body.id)
    .maybeSingle<ProjectBudgetLine>()
  if (readErr) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  if (!line) return NextResponse.json({ error: 'Linje ikke funnet' }, { status: 404 })

  const updates: Partial<ProjectBudgetLine> = {}

  if (body.line_type !== undefined) {
    updates.line_type = body.line_type as ProjectBudgetLine['line_type']
  }

  if (body.assigned_subcontractor_id !== undefined) {
    updates.assigned_subcontractor_id = body.assigned_subcontractor_id
    if (body.assigned_subcontractor_id && body.assigned_subcontractor_id !== '__intern__') {
      // Look up the UE's price for this product so we can snapshot it.
      const { data: price } = await sb
        .from('subcontractor_product_prices')
        .select('cost_price')
        .eq('subcontractor_id', body.assigned_subcontractor_id)
        .eq('product_id', line.product_id)
        .maybeSingle<Pick<SubcontractorProductPrice, 'cost_price'>>()
      if (!price) {
        return NextResponse.json(
          { error: 'Underentreprenør mangler pris på dette produktet. Legg inn pris først.' },
          { status: 400 },
        )
      }
      updates.subcontractor_cost_price_snapshot = price.cost_price
    } else {
      updates.subcontractor_cost_price_snapshot = 0
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Ingen felter å oppdatere' }, { status: 400 })
  }

  const { data, error } = await sb
    .from('project_budget_lines')
    .update(updates)
    .eq('id', body.id)
    .select()
    .maybeSingle<ProjectBudgetLine>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(data)
}
