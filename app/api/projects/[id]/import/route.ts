import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { uploadBudgetFile } from '@/lib/storage'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import { parseExcelBuffer } from '@/lib/excel'
import { DEFAULT_IMPORT_MAP } from '@/lib/excel-map'
import { importExcelLines } from '@/lib/excel-import'
import { budgetSalesValue, budgetCostValue, emCustomerValue, emCost } from '@/lib/project-economy'
import type { Project, ProjectBudgetLine, BudgetVersion, ChangeOrder, ImportColumnMap } from '@/types'

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const denied = await ensureProjectWritable(auth.user, params.id)
  if (denied) return denied

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Mangler fil' }, { status: 400 })

  const uploadedBy = auth.user.full_name
  const sb = getSupabaseAdmin()

  // Targeted project lookup instead of full-table.
  const { data: project, error: projErr } = await sb
    .from('projects')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<Project>()
  if (projErr) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  if (!project) return NextResponse.json({ error: 'Prosjekt ikke funnet' }, { status: 404 })

  // Kundens kolonneoppsett fra prosjekttypen (faller tilbake til standard).
  let importMap = DEFAULT_IMPORT_MAP
  if (project.project_type_id) {
    const { data: pt } = await sb
      .from('project_types')
      .select('import_config')
      .eq('id', project.project_type_id)
      .maybeSingle<{ import_config: ImportColumnMap | null }>()
    if (pt?.import_config) importMap = pt.import_config
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  let parsed
  try {
    parsed = parseExcelBuffer(buffer, importMap)
  } catch {
    return NextResponse.json({ error: 'Kunne ikke lese Excel-fil' }, { status: 422 })
  }

  // Update project metadata from the Excel header (name / project nr / order nr).
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
    await sb.from('projects').update(updatedFields).eq('id', params.id)
  }

  const result = await importExcelLines(project.id, project.county, parsed.lines)

  // Snapshot budget totals after import — manual lines + approved COs.
  const [blRes, coRes] = await Promise.all([
    sb.from('project_budget_lines')
      .select('budget_quantity, customer_price_snapshot, subcontractor_cost_price_snapshot, source')
      .eq('project_id', params.id),
    sb.from('change_orders')
      .select('total_customer_value, total_cost')
      .eq('project_id', params.id).eq('status', 'approved'),
  ])

  const budgetLines = ((blRes.data ?? []) as ProjectBudgetLine[])
    .filter((bl) => !bl.source || bl.source === 'manual')
  const manualSales = budgetSalesValue(budgetLines)
  const manualCost = budgetCostValue(budgetLines)
  const approvedCOs = (coRes.data ?? []) as Pick<ChangeOrder, 'total_customer_value' | 'total_cost'>[]
  const coSales = emCustomerValue(approvedCOs)
  const coCost = emCost(approvedCOs)

  const totalSalesValue = manualSales + coSales
  const totalCostValue = manualCost + coCost

  // Next version number — count existing versions for this project.
  const { data: existingVersions } = await sb
    .from('budget_versions')
    .select('version')
    .eq('project_id', params.id)
  const versions = (existingVersions ?? []) as Pick<BudgetVersion, 'version'>[]
  const nextVersion = versions.length === 0 ? 0 : Math.max(...versions.map((v) => v.version)) + 1

  // Upload the Excel to private Storage. Key = `<project_id>/<versionId>_<sanitized>`.
  // The path lives in budget_versions.file_name; downloads mint a signed URL on demand.
  const versionId = randomUUID()
  const originalName = file.name || 'budsjett.xlsx'
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectPath = `${params.id}/${versionId}_${safeName}`

  try {
    await uploadBudgetFile({ path: objectPath, bytes: buffer, contentType: EXCEL_MIME })
  } catch (err) {
    console.error('budget file upload:', err)
    return NextResponse.json({ error: 'Kunne ikke lagre Excel-fil' }, { status: 500 })
  }

  const versionRow: BudgetVersion = {
    id: versionId,
    project_id: params.id,
    version: nextVersion,
    total_sales_value: totalSalesValue,
    total_cost_value: totalCostValue,
    uploaded_by: uploadedBy,
    uploaded_at: new Date().toISOString(),
    file_name: objectPath,
  }
  const { error: insErr } = await sb.from('budget_versions').insert(versionRow)
  if (insErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  return NextResponse.json({ ...result, skipped: parsed.skipped, ok: true, updated_fields: updatedFields })
}
