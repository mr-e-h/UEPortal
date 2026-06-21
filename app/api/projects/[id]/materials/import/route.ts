import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { uploadBudgetFile } from '@/lib/storage'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import { parseMaterialBuffer } from '@/lib/materials'
import type { ProjectMaterial, ProjectMaterialVersion } from '@/types'

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// ─── POST /api/projects/[id]/materials/import ─────────────────────────────────
// Multipart: field 'file' = xlsx.
//
// Model A — budsjett-stil: HVER opplasting lager en ny project_material_versions-rad.
//   version = (max eksisterende version) + 1, eller 0 dersom ingen finnes.
//   snapshot = den NYE parsede materiellisten.
//   file_name = budget-files-stien til den opplastede filen.
//
// Flyt:
//   (a) parse Excel med parseMaterialBuffer
//   (b) last opp .xlsx til budget-files-bucket under <project_id>/materials/<uuid>_<name>
//   (c) beregn neste versjonsnummer
//   (d) sett inn versjon-rad med snapshot = DEN NYE lista + file_name = objektstien
//   (e) ERSTATT KUN Excel-radene (source='excel') — manuelt tillagte rader
//       (source='manual') beholdes
//
// Returnerer { ok, imported, skipped, version }

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

  // (a) Parse Excel
  const buffer = Buffer.from(await file.arrayBuffer())
  let parsed: ReturnType<typeof parseMaterialBuffer>
  try {
    parsed = parseMaterialBuffer(buffer)
  } catch {
    return NextResponse.json({ error: 'Kunne ikke lese Excel-fil' }, { status: 422 })
  }

  const sb = getSupabaseAdmin()
  const projectId = params.id

  // (b) Last opp Excel til budget-files-bucket
  const originalName = file.name || 'materiell.xlsx'
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const fileId = randomUUID()
  const objectPath = `${projectId}/materials/${fileId}_${safeName}`

  try {
    await uploadBudgetFile({ path: objectPath, bytes: buffer, contentType: EXCEL_MIME })
  } catch (err) {
    console.error('material file upload:', err)
    return NextResponse.json({ error: 'Kunne ikke lagre Excel-fil' }, { status: 500 })
  }

  // (c) Beregn neste versjonsnummer
  const { data: versionRows } = await sb
    .from('project_material_versions')
    .select('version')
    .eq('project_id', projectId)

  const versions = ((versionRows ?? []) as Pick<ProjectMaterialVersion, 'version'>[])
  const maxVersion = versions.length === 0 ? -1 : Math.max(...versions.map((v) => v.version))
  const nextVersion = maxVersion + 1

  // (d) Bygg versjon-rad — snapshot = DEN NYE parsede lista
  const snapshot: ProjectMaterialVersion['snapshot'] = {
    materials: parsed.materials.map((m) => ({
      material_code: m.material_code,
      material_name: m.material_name,
      category: m.category,
      unit: '',
      planned_quantity: m.planned_quantity,
      unit_price: m.unit_price,
      supplier: m.supplier,
    })),
  }

  const versionRow: Omit<ProjectMaterialVersion, 'created_at'> = {
    id: randomUUID(),
    project_id: projectId,
    version: nextVersion,
    file_name: objectPath,
    snapshot,
    uploaded_by: auth.user.full_name,
    uploaded_at: new Date().toISOString(),
  }

  const { error: snapErr } = await sb.from('project_material_versions').insert(versionRow)
  if (snapErr) return NextResponse.json({ error: 'Versjon-lagring feilet' }, { status: 500 })

  // (e) ERSTATT KUN EXCEL-RADENE: slett source='excel', behold manuelt tillagte
  // rader (source='manual'). Slik overlever manuelt materiell en ny opplasting.
  const { error: delErr } = await sb
    .from('project_materials')
    .delete()
    .eq('project_id', projectId)
    .eq('source', 'excel')
  if (delErr) return NextResponse.json({ error: 'Sletting av gamle Excel-rader feilet' }, { status: 500 })

  const newRows: Omit<ProjectMaterial, 'created_at'>[] = parsed.materials.map((m, idx) => ({
    id: randomUUID(),
    project_id: projectId,
    material_code: m.material_code,
    material_name: m.material_name,
    category: m.category,
    unit: '',          // Excel-arket har ingen unit-kolonne; settes manuelt etterpå om nødvendig
    planned_quantity: m.planned_quantity,
    unit_price: m.unit_price,
    supplier: m.supplier,
    actual_quantity: null,
    reconciled: false,
    comment: '',
    sort_order: idx,
    source: 'excel',
  }))

  if (newRows.length > 0) {
    const { error: insErr } = await sb.from('project_materials').insert(newRows)
    if (insErr) return NextResponse.json({ error: 'Innsetting feilet' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    imported: newRows.length,
    skipped: parsed.skipped,
    version: nextVersion,
  })
}
