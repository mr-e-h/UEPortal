import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson, getDeletedProjectIds } from '@/lib/data'
import { requireAuth, requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ProjectBudgetLine, Product, SubcontractorProductPrice } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const params = new URL(request.url).searchParams
  const deletedProjectIds = getDeletedProjectIds()
  let lines = readJson<ProjectBudgetLine>('project_budget_lines.json').filter((l) => !deletedProjectIds.has(l.project_id))
  const projectId = params.get('project_id')
  const subcontractorId = params.get('subcontractor_id')
  if (projectId) lines = lines.filter((l) => l.project_id === projectId)
  if (subcontractorId) lines = lines.filter((l) => l.assigned_subcontractor_id === subcontractorId)
  return NextResponse.json(lines)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { project_id: string; product_id: string; budget_quantity: number }
  const products = readJson<Product>('products.json')
  const product = products.find((p) => p.id === body.product_id)
  if (!product) return NextResponse.json({ error: 'Produkt ikke funnet' }, { status: 404 })

  const lines = readJson<ProjectBudgetLine>('project_budget_lines.json')
  const newLine: ProjectBudgetLine = {
    id: randomUUID(),
    project_id: body.project_id,
    product_id: body.product_id,
    budget_quantity: Number(body.budget_quantity),
    customer_price_snapshot: product.customer_price,
    assigned_subcontractor_id: null,
    subcontractor_cost_price_snapshot: 0,
  }
  writeJson('project_budget_lines.json', [...lines, newLine])
  return NextResponse.json(newLine, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { id: string; assigned_subcontractor_id: string | null }
  const lines = readJson<ProjectBudgetLine>('project_budget_lines.json')
  const idx = lines.findIndex((l) => l.id === body.id)
  if (idx === -1) return NextResponse.json({ error: 'Linje ikke funnet' }, { status: 404 })

  let costSnapshot = 0
  if (body.assigned_subcontractor_id && body.assigned_subcontractor_id !== '__intern__') {
    const prices = readJson<SubcontractorProductPrice>('subcontractor_product_prices.json')
    const price = prices.find(
      (p) => p.subcontractor_id === body.assigned_subcontractor_id && p.product_id === lines[idx].product_id
    )
    if (!price) {
      return NextResponse.json(
        { error: 'Underentreprenør mangler pris på dette produktet. Legg inn pris først.' },
        { status: 400 }
      )
    }
    costSnapshot = price.cost_price
  }

  lines[idx] = {
    ...lines[idx],
    assigned_subcontractor_id: body.assigned_subcontractor_id,
    subcontractor_cost_price_snapshot: costSnapshot,
  }
  writeJson('project_budget_lines.json', lines)
  return NextResponse.json(lines[idx])
}
