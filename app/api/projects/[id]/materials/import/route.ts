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
// Flyt:
//   (a) parse Excel med parseMaterialBuffer
//   (b) hvis prosjektet har eksisterende rader → snapshot dem til project_material_versions
//   (c) last opp .xlsx til budget-files-bucket under <project_id>/materials/<uuid>_<name>
//   (d) ERSTATT: slett gamle rader, sett inn ny liste
//
// Returnerer { ok, imported, skipped, version }
// version = versjonsnummeret som ble opprettet i (b), eller null om ingen fantes.

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

  // (b) Snapshot eksisterende rader hvis de finnes
  const { data: existing, error: fetchErr } = await sb
    .from('project_materials')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })

  if (fetchErr) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })

  const existingRows = (existing ?? []) as ProjectMaterial[]
  let nextVersion: number | null = null

  if (existingRows.length > 0) {
    // Finn høyeste versjonsnummer
    const { data: versionRows } = await sb
      .from('project_material_versions')
      .select('version')
      .eq('project_id', projectId)

    const versions = ((versionRows ?? []) as Pick<ProjectMaterialVersion, 'version'>[])
    const maxVersion = versions.length === 0 ? -1 : Math.max(...versions.map((v) => v.version))
    nextVersion = maxVersion + 1

    // Bygg snapshot — kun felter definert i ProjectMaterialVersion.snapshot
    const snapshot: ProjectMaterialVersion['snapshot'] = {
      materials: existingRows.map((r) => ({
        material_code: r.material_code,
        material_name: r.material_name,
        category: r.category,
        unit: r.unit,
        planned_quantity: r.planned_quantity,
        unit_price: r.unit_price,
        supplier: r.supplier,
      })),
    }

    const versionRow: Omit<ProjectMaterialVersion, 'created_at'> = {
      id: randomUUID(),
      project_id: projectId,
      version: nextVersion,
      file_name: file.name ?? null,
      snapshot,
      uploaded_by: auth.user.full_name,
      uploaded_at: new Date().toISOString(),
    }

    const { error: snapErr } = await sb.from('project_material_versions').insert(versionRow)
    if (snapErr) return NextResponse.json({ error: 'Snapshot-lagring feilet' }, { status: 500 })
  }

  // (c) Last opp Excel til budget-files-bucket
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

  // (d) ERSTATT: slett eksisterende, sett inn ny liste
  if (existingRows.length > 0) {
    const { error: delErr } = await sb
      .from('project_materials')
      .delete()
      .eq('project_id', projectId)
    if (delErr) return NextResponse.json({ error: 'Sletting av gamle rader feilet' }, { status: 500 })
  }

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
