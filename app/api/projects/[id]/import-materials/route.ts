import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { uploadBudgetFile } from '@/lib/storage'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import { parseExcelBuffer } from '@/lib/excel'
import { MATERIAL_IMPORT_MAP } from '@/lib/excel-map'
import { importExcelLines } from '@/lib/excel-import'
import type { Project } from '@/types'

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

  const sb = getSupabaseAdmin()

  const { data: project, error: projErr } = await sb
    .from('projects')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<Project>()
  if (projErr) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  if (!project) return NextResponse.json({ error: 'Prosjekt ikke funnet' }, { status: 404 })

  const buffer = Buffer.from(await file.arrayBuffer())
  let parsed
  try {
    parsed = parseExcelBuffer(buffer, MATERIAL_IMPORT_MAP)
  } catch {
    return NextResponse.json({ error: 'Kunne ikke lese Excel-fil' }, { status: 422 })
  }

  // Import lines as material type. costEqualsPrice=true means subcontractor_cost_price_snapshot
  // is set equal to the unit_price (pass-through margin = 0 until a UE is assigned).
  const result = await importExcelLines(
    project.id,
    project.county,
    parsed.lines,
    { lineType: 'material', costEqualsPrice: true },
  )

  // Upload the file to budget-files bucket for traceability.
  // We do NOT create a budget_version row — material import adds to the
  // existing budget without replacing it, so no new version snapshot is needed.
  const fileId = randomUUID()
  const originalName = file.name || 'materielliste.xlsx'
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectPath = `${params.id}/materials/${fileId}_${safeName}`

  try {
    await uploadBudgetFile({ path: objectPath, bytes: buffer, contentType: EXCEL_MIME })
  } catch (err) {
    // Non-fatal: the import already succeeded. Log but do not fail the request.
    console.error('material file upload:', err)
  }

  return NextResponse.json({ ...result, skipped: parsed.skipped, ok: true })
}
