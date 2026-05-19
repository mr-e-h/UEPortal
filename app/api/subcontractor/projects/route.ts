import { NextRequest, NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin } from '@/lib/api-guard'
import type { Project, ProjectSubcontractor, ProjectBudgetLine, Product } from '@/types'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const requestedSubId = new URL(request.url).searchParams.get('subcontractor_id')
  if (!requestedSubId) return NextResponse.json({ error: 'subcontractor_id required' }, { status: 400 })

  // Non-admin users can only access their own subcontractor data
  if (!isAdmin(session) && session.subcontractor_id !== requestedSubId) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const subcontractorId = requestedSubId

  const links = await readJson<ProjectSubcontractor>('project_subcontractors.json')
  const projects = await readJson<Project>('projects.json')
  const allBudgetLines = await readJson<ProjectBudgetLine>('project_budget_lines.json')
  const allProducts = await readJson<Product>('products.json')

  const projectIds = links.filter((l) => l.subcontractor_id === subcontractorId).map((l) => l.project_id)

  const result = projects
    .filter((p) => projectIds.includes(p.id) && !p.deleted)
    .map((project) => {
      const assignedLines = allBudgetLines.filter(
        (bl) =>
          bl.project_id === project.id &&
          bl.assigned_subcontractor_id === subcontractorId &&
          (bl.line_type === 'subcontractor_work' || bl.line_type == null)
      )
      const linesWithProduct = assignedLines.map((bl) => {
        const product = allProducts.find((p) => p.id === bl.product_id)
        return {
          id: bl.id,
          product_id: bl.product_id,
          product_name: product?.name ?? '',
          product_description: product?.description ?? '',
          unit: product?.unit ?? '',
          budget_quantity: bl.budget_quantity,
          subcontractor_cost_price_snapshot: bl.subcontractor_cost_price_snapshot,
        }
      })
      return { ...project, budget_lines: linesWithProduct }
    })

  return NextResponse.json(result)
}
