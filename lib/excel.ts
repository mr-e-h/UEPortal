import * as XLSX from 'xlsx'
import { parseRows, DEFAULT_IMPORT_MAP, type ImportColumnMap, type ParsedLine, type SkippedRow } from '@/lib/excel-map'

export type ParsedExcelLine = ParsedLine

export type ParsedExcelResult = {
  project_number: string
  project_name: string
  order_number: string
  lines: ParsedExcelLine[]
  skipped: SkippedRow[]
}

function extractAfterColon(raw: string): string {
  const idx = raw.indexOf(':')
  return idx >= 0 ? raw.slice(idx + 1).trim() : raw.trim()
}

/** Rårutenett (alle celler som strenger) fra første ark — for forhåndsvisningen
 *  i import-oppsettet, der brukeren ser kolonnene og hva som leses/hoppes. */
export function readSheetRows(buffer: Buffer): unknown[][] {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const ws = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
}

/**
 * Parse Excel-bufferen etter et kolonneoppsett (default = den gamle layouten,
 * så eksisterende prosjekttyper uten egen config oppfører seg som før).
 */
export function parseExcelBuffer(buffer: Buffer, map: ImportColumnMap = DEFAULT_IMPORT_MAP): ParsedExcelResult {
  const rows = readSheetRows(buffer)
  const project_number = extractAfterColon(String((rows[0] as unknown[])?.[0] ?? ''))
  const project_name = extractAfterColon(String((rows[1] as unknown[])?.[0] ?? ''))
  const order_number = extractAfterColon(String((rows[2] as unknown[])?.[0] ?? ''))

  const { lines, skipped } = parseRows(rows, map)
  return { project_number, project_name, order_number, lines, skipped }
}
