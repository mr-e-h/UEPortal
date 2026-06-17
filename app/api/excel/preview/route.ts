import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-guard'
import { readSheetRows } from '@/lib/excel'

/**
 * Leser et eksempel-Excel og returnerer rårutenettet (rader × celler som
 * strenger) for den visuelle kolonne-mappingen i Prosjekttype-oppsettet. Lagrer
 * ingenting — kun parsing. Klienten kjører selve mappingen/forhåndsvisningen
 * lokalt (lib/excel-map.parseRows) så endringer føles direkte.
 */
const MAX_ROWS = 500
const MAX_COLS = 26

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Mangler fil' }, { status: 400 })

  let rows: unknown[][]
  try {
    rows = readSheetRows(Buffer.from(await file.arrayBuffer()))
  } catch {
    return NextResponse.json({ error: 'Kunne ikke lese Excel-fil' }, { status: 422 })
  }

  const colCount = Math.min(
    MAX_COLS,
    rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0),
  )
  const grid = rows.slice(0, MAX_ROWS).map((r) =>
    Array.from({ length: colCount }, (_, c) => String((r as unknown[])?.[c] ?? '')),
  )

  return NextResponse.json({
    grid,
    colCount,
    totalRows: rows.length,
    truncated: rows.length > MAX_ROWS,
    fileName: file.name,
  })
}
