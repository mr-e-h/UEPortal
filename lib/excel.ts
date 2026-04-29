import * as XLSX from 'xlsx'

export type ParsedExcelLine = {
  product_code: string
  product_name: string
  unit_price: number
  budget_quantity: number
}

export type ParsedExcelResult = {
  project_number: string
  project_name: string
  order_number: string
  lines: ParsedExcelLine[]
}

function extractAfterColon(raw: string): string {
  const idx = raw.indexOf(':')
  return idx >= 0 ? raw.slice(idx + 1).trim() : raw.trim()
}

// Lump-sum product codes: qty = largest of (fastpris, antall2, pris2), price = 1 kr always.
const LUMP_SUM_CODES = new Set([
  'U0000', 'U0000A', 'U0000B', 'U0000C',
  'ULG39A', 'ULG39B', 'ULG39C', 'ULG39D',
  'CDM0001', 'CMD0001',
  'ULG17', 'ULG17A', 'ULG17B', 'ULG17C',
])

export function parseExcelBuffer(buffer: Buffer): ParsedExcelResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const ws = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })

  const project_number = extractAfterColon(String((rows[0] as unknown[])?.[0] ?? ''))
  const project_name = extractAfterColon(String((rows[1] as unknown[])?.[0] ?? ''))
  const order_number = extractAfterColon(String((rows[2] as unknown[])?.[0] ?? ''))

  const lines: ParsedExcelLine[] = []
  for (let i = 5; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    const product_code = String(row[1] ?? '').trim()
    if (!product_code) continue

    const product_name = String(row[2] ?? '').trim()
    const pris2 = Number(row[5]) || 0
    const antall2 = Number(row[6]) || 0
    const fastpris = Number(row[7]) || 0

    let unit_price: number
    let budget_quantity: number

    if (fastpris > 0) {
      unit_price = fastpris
      budget_quantity = 1
    } else if (pris2 === 1 && antall2 > 1) {
      unit_price = antall2
      budget_quantity = 1
    } else {
      unit_price = pris2
      budget_quantity = antall2
    }

    if (LUMP_SUM_CODES.has(product_code)) {
      budget_quantity = Math.max(fastpris, antall2, pris2)
      unit_price = 1
    }

    if (unit_price <= 0) continue

    lines.push({ product_code, product_name, unit_price, budget_quantity })
  }

  return { project_number, project_name, order_number, lines }
}
