import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { Project, ProjectBudgetLine, BudgetVersion, ProjectSubcontractor } from '@/types'
import { importExcelLines } from '@/lib/excel-import'
import { budgetSalesValue, budgetCostValue } from '@/lib/project-economy'
import type { ParsedExcelLine } from '@/lib/excel'
import { getSession } from '@/lib/auth'
import { requireAdmin, getProjectScope } from '@/lib/api-guard'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const sb = getSupabaseAdmin()
  const isSubRole = session.role === 'sub'

  const { data, error } = await sb.from('projects').select('*').neq('deleted', true)
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let projects = (data ?? []) as Project[]

  if (isSubRole) {
    if (!session.subcontractor_id) return NextResponse.json([])
    const { data: psData } = await sb
      .from('project_subcontractors')
      .select('project_id')
      .eq('subcontractor_id', session.subcontractor_id)
    const allowedIds = new Set(
      ((psData ?? []) as Pick<ProjectSubcontractor, 'project_id'>[]).map((ps) => ps.project_id),
    )
    // Minimalt feltsett til UE — ALDRI select('*') (ordrenr, planlagte timer og
    // ev. framtidige økonomikolonner skal aldri følge med til en UE).
    const own = projects
      .filter((p) => allowedIds.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        project_number: p.project_number,
        customer: p.customer,
        county: p.county,
        status: p.status,
        start_date: p.start_date,
        end_date: p.end_date,
      }))
    return NextResponse.json(own)
  }

  // project_manager → only their assigned projects (Q1).
  // main / company / other admins see everything.
  const scope = await getProjectScope(session)
  if (scope) projects = projects.filter((p) => scope.has(p.id))

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

  const newProject: Project = {
    ...projectData,
    id: randomUUID(),
    status: projectData.status ?? 'active',
    end_date: projectData.end_date ?? null,
    deleted: false,
    deleted_at: null,
  }
  const sb = getSupabaseAdmin()
  const { error: insErr } = await sb.from('projects').insert(newProject)
  if (insErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  // PM who creates a project should automatically own it — otherwise they
  // can't see it after refresh. main/company need no such row (they see all).
  if (auth.user.role === 'project_manager') {
    await sb.from('project_managers').insert({
      project_id: newProject.id,
      user_id: auth.user.id,
      assigned_by: auth.user.id,
    })
  }

  let imported = 0
  let new_products = 0

  if (import_excel && excel_data?.length) {
    const result = await importExcelLines(newProject.id, newProject.county, excel_data)
    imported = result.imported
    new_products = result.new_products

    // Snapshot a baseline version-0 row.
    const { data: blData } = await sb
      .from('project_budget_lines')
      .select('budget_quantity, customer_price_snapshot, subcontractor_cost_price_snapshot, source')
      .eq('project_id', newProject.id)
    const budgetLines = ((blData ?? []) as ProjectBudgetLine[])
      .filter((bl) => !bl.source || bl.source === 'manual')
    const totalSalesValue = budgetSalesValue(budgetLines)
    const totalCostValue = budgetCostValue(budgetLines)

    const versionRow: BudgetVersion = {
      id: randomUUID(),
      project_id: newProject.id,
      version: 0,
      total_sales_value: totalSalesValue,
      total_cost_value: totalCostValue,
      uploaded_by: auth.user.full_name ?? 'Ukjent',
      uploaded_at: new Date().toISOString(),
    }
    await sb.from('budget_versions').insert(versionRow)
  }

  return NextResponse.json({ ...newProject, imported, new_products }, { status: 201 })
}
