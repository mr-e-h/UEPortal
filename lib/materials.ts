/**
 * Parse-logikk for materiell-Excel-opplasting. Helt adskilt fra produktbudsjett /
 * excel-map.ts — materiell-arket har sitt eget layout og egne felter.
 *
 * Layout (1-indekserte kolonner, data fra rad 6):
 *   A (0) Kategori
 *   B (1) Materiellkode
 *   C (2) Materiellnavn
 *   D (3) Pris
 *   E (4) Antall
 *   F (5) Sum   ← leses ikke (utregnet felt i Excel)
 *   G (6) Leverandør
 */

import { readSheetRows } from '@/lib/excel'

export interface ParsedMaterial {
  material_code: string
  material_name: string
  category: string
  unit_price: number
  planned_quantity: number
  supplier: string
}

export interface MaterialParseResult {
  materials: ParsedMaterial[]
  skipped: { row: number; code: string; name: string; reason: string }[]
}

// ─── cell helpers (same pattern as lib/excel-map.ts) ─────────────────────────

const cellStr = (row: unknown[], idx: number): string =>
  String(row?.[idx] ?? '').trim()

/** Tall fra en celle. Tåler norsk tekstformat ("1 234,5") som fallback. */
const cellNum = (row: unknown[], idx: number): number => {
  const raw = row?.[idx]
  if (typeof raw === 'number') return raw
  const n = Number(String(raw ?? '').replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

// ─── parser ───────────────────────────────────────────────────────────────────

/** Data starter fra rad 6 (1-basert) = indeks 5 (0-basert). */
const DATA_START = 5

export function parseMaterialBuffer(buffer: Buffer): MaterialParseResult {
  const rows = readSheetRows(buffer)
  const materials: ParsedMaterial[] = []
  const skipped: MaterialParseResult['skipped'] = []

  for (let i = DATA_START; i < rows.length; i++) {
    const row = (rows[i] ?? []) as unknown[]

    const category = cellStr(row, 0)
    const material_code = cellStr(row, 1)
    const material_name = cellStr(row, 2)
    const unit_price = cellNum(row, 3)
    const planned_quantity = cellNum(row, 4)
    // kolonne 5 = Sum (utregnet), hoppes over
    const supplier = cellStr(row, 6)

    // Helt tom rad → stille hopp (seksjonsskiller i Excel-arket)
    if (!category && !material_code && !material_name && unit_price === 0 && planned_quantity === 0 && !supplier) {
      continue
    }

    // Mangler kode eller navn → hopp + rapporter
    if (!material_code && !material_name) {
      continue // begge tomme og raden er ikke "tom" (supplier kan ha verdi) — hopp stille
    }
    if (!material_code) {
      skipped.push({ row: i + 1, code: '', name: material_name, reason: 'Mangler materiellkode' })
      continue
    }
    if (!material_name) {
      skipped.push({ row: i + 1, code: material_code, name: '', reason: 'Mangler materiellnavn' })
      continue
    }

    materials.push({ material_code, material_name, category, unit_price, planned_quantity, supplier })
  }

  return { materials, skipped }
}
