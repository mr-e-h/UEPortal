import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import type { Project, ProjectBudgetLine, BudgetVersion, ChangeOrder } from '@/types'
import { parseExcelBuffer } from '@/lib/excel'
import { importExcelLines } from '@/lib/excel-import'
import { requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const uploadedBy = (formData.get('uploaded_by') as string | null) ?? 'Ukjent'

  const projects = await readJson<Project>('projects.json')
  const projectIdx = projects.findIndex((p) => p.id === params.id)
  if (projectIdx === -1) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const project = projects[projectIdx]

  const buffer = Buffer.from(await file.arrayBuffer())
  let parsed
  try {
    parsed = parseExcelBuffer(buffer)
  } catch {
    return NextResponse.json({ error: 'Could not parse Excel file' }, { status: 422 })
  }

  // Update project metadata from Excel header (name, project_number, order_number)
  const updatedFields: Partial<Project> = {}
  if (parsed.project_name && parsed.project_name !== project.name) {
    updatedFields.name = parsed.project_name
  }
  if (parsed.project_number && parsed.project_number !== project.project_number) {
    updatedFields.project_number = parsed.project_number
  }
  if (parsed.order_number && parsed.order_number !== project.order_number) {
    updatedFields.order_number = parsed.order_number
  }

  if (Object.keys(updatedFields).length > 0) {
    projects[projectIdx] = { ...project, ...updatedFields }
    await writeJson('projects.json', projects)
  }

  const result = await importExcelLines(project.id, project.county, parsed.lines)

  // Snapshot budget totals after the import — mirrors project page: manual lines + approved change orders
  const budgetLines = (await readJson<ProjectBudgetLine>('project_budget_lines.json')).filter(
    (bl) => bl.project_id === params.id && (!bl.source || bl.source === 'manual')
  )
  const manualSales = budgetLines.reduce((s, bl) => s + bl.budget_quantity * bl.customer_price_snapshot, 0)
  const manualCost = budgetLines.reduce((s, bl) => s + bl.budget_quantity * bl.subcontractor_cost_price_snapshot, 0)

  const approvedCOs = (await readJson<ChangeOrder>('change_orders.json')).filter(
    (co) => co.project_id === params.id && co.status === 'approved'
  )
  const coSales = approvedCOs.reduce((s, co) => s + co.total_customer_value, 0)
  const coCost = approvedCOs.reduce((s, co) => s + co.total_cost, 0)

  const totalSalesValue = manualSales + coSales
  const totalCostValue = manualCost + coCost

  const versions = await readJson<BudgetVersion>('budget_versions.json')
  const projectVersions = versions.filter((v) => v.project_id === params.id)
  const nextVersion = projectVersions.length === 0 ? 0 : Math.max(...projectVersions.map((v) => v.version)) + 1

  const versionId = randomUUID()
  const originalName = file.name || 'budsjett.xlsx'
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storedFileName = `${versionId}_${safeName}`
  const uploadsDir = path.join(process.cwd(), 'data', 'uploads')
  fs.mkdirSync(uploadsDir, { recursive: true })
  fs.writeFileSync(path.join(uploadsDir, storedFileName), buffer)

  versions.push({
    id: versionId,
    project_id: params.id,
    version: nextVersion,
    total_sales_value: totalSalesValue,
    total_cost_value: totalCostValue,
    uploaded_by: uploadedBy,
    uploaded_at: new Date().toISOString(),
    file_name: storedFileName,
  })
  await writeJson('budget_versions.json', versions)

  return NextResponse.json({ ...result, ok: true, updated_fields: updatedFields })
}
