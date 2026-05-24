import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import type { Project, ProjectBudgetLine, BudgetVersion } from '@/types'
import { importExcelLines } from '@/lib/excel-import'
import type { ParsedExcelLine } from '@/lib/excel'
import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  const isSubRole = session.role === 'sub'
  let projects = (await readJson<Project>('projects.json')).filter((p) => !p.deleted)

  if (isSubRole) {
    if (!session.subcontractor_id) return NextResponse.json([])
    const projectSubs = await readJson<{ id: string; project_id: string; subcontractor_id: string }>('project_subcontractors.json')
    const allowedIds = new Set(
      projectSubs.filter((ps) => ps.subcontractor_id === session.subcontractor_id).map((ps) => ps.project_id)
    )
    projects = projects.filter((p) => allowedIds.has(p.id))
  }

  return NextResponse.json(projects)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Omit<Project, 'id'> & {
    import_excel?: boolean
    excel_data?: ParsedExcelLine[]
  }

  const { import_excel, excel_data, ...projectData } = body

  const projects = await readJson<Project>('projects.json')
  const newProject: Project = {
    ...projectData,
    id: String(Date.now()),
    status: projectData.status ?? 'active',
    end_date: projectData.end_date ?? null,
    deleted: false,
    deleted_at: null,
  }
  await writeJson('projects.json', [...projects, newProject])

  let imported = 0
  let new_products = 0

  if (import_excel && excel_data?.length) {
    const result = await importExcelLines(newProject.id, newProject.county, excel_data)
    imported = result.imported
    new_products = result.new_products

    // Record version 0 after the initial import
    const budgetLines = (await readJson<ProjectBudgetLine>('project_budget_lines.json')).filter(
      (bl) => bl.project_id === newProject.id && (!bl.source || bl.source === 'manual')
    )
    const totalSalesValue = budgetLines.reduce((s, bl) => s + bl.budget_quantity * bl.customer_price_snapshot, 0)
    const totalCostValue = budgetLines.reduce((s, bl) => s + bl.budget_quantity * bl.subcontractor_cost_price_snapshot, 0)
    const session = await getSession()
    const versions = await readJson<BudgetVersion>('budget_versions.json')
    versions.push({
      id: randomUUID(),
      project_id: newProject.id,
      version: 0,
      total_sales_value: totalSalesValue,
      total_cost_value: totalCostValue,
      uploaded_by: session?.full_name ?? 'Ukjent',
      uploaded_at: new Date().toISOString(),
    })
    await writeJson('budget_versions.json', versions)
  }

  return NextResponse.json({ ...newProject, imported, new_products }, { status: 201 })
}
