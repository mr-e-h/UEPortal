import { isLumpSumCode } from '@/lib/lump-sum-codes'
import type { ImportColumnMap } from '@/types'

/**
 * Ren parse-logikk for Excel-import (INGEN xlsx-avhengighet, så den kan kjøre
 * både server-side ved import OG klient-side i forhåndsvisningen i
 * Prosjekttype-oppsettet). Tar ut produktlinjer fra et allerede uthentet
 * rutenett (rader × celler) etter et kolonneoppsett, og rapporterer hvilke
 * rader som HOPPES OVER og hvorfor — så ingenting forsvinner stille.
 *
 * Verdi-utledningen (fastpris / pris×antall / rundsum-koder) er beholdt
 * VERBATIM fra den gamle hardkodede parseren, så tallene blir identiske; det er
 * bare KOLONNEPOSISJONENE som nå er konfigurerbare.
 */

export type { ImportColumnMap }

/** Standardoppsett = den gamle hardkodede layouten (kol B/C/F/G/H, rad 6). */
export const DEFAULT_IMPORT_MAP: ImportColumnMap = {
  startRow: 6, code: 1, name: 2, price: 5, qty: 6, fixedPrice: 7,
}

export const IMPORT_FIELDS = ['code', 'name', 'price', 'qty', 'fixedPrice'] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export const FIELD_LABEL: Record<ImportField, string> = {
  code: 'Produktkode',
  name: 'Produktnavn',
  price: 'Pris',
  qty: 'Antall',
  fixedPrice: 'Fastpris',
}

export interface ParsedLine {
  product_code: string
  product_name: string
  unit_price: number
  budget_quantity: number
}

export interface SkippedRow { row: number; code: string; name: string; reason: string }
export interface ParseRowsResult { lines: ParsedLine[]; skipped: SkippedRow[] }

const cellStr = (row: unknown[], idx: number | null): string =>
  idx == null ? '' : String(row?.[idx] ?? '').trim()

/** Tall fra en celle. Tåler norsk tekstformat ("1 234,5") som fallback når
 *  cellen ikke allerede er et tall. */
const cellNum = (row: unknown[], idx: number | null): number => {
  if (idx == null) return 0
  const raw = row?.[idx]
  if (typeof raw === 'number') return raw
  const n = Number(String(raw ?? '').replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export function parseRows(rows: unknown[][], map: ImportColumnMap): ParseRowsResult {
  const lines: ParsedLine[] = []
  const skipped: SkippedRow[] = []
  const start = Math.max(1, map.startRow || 1) - 1

  for (let i = start; i < rows.length; i++) {
    const row = rows[i] ?? []
    const product_code = cellStr(row, map.code)
    const product_name = cellStr(row, map.name)
    const pris2 = cellNum(row, map.price)
    const antall2 = cellNum(row, map.qty)
    const fastpris = cellNum(row, map.fixedPrice)

    // Helt tom rad → bare hopp over, ikke rapporter (skiller mellom seksjoner).
    if (!product_code && !product_name && pris2 === 0 && antall2 === 0 && fastpris === 0) continue

    // Kode er kartlagt, men mangler på denne raden.
    if (map.code != null && !product_code) {
      skipped.push({ row: i + 1, code: '', name: product_name, reason: 'Mangler produktkode' })
      continue
    }

    let unit_price: number
    let budget_quantity: number
    // Fastpris ≠ 0 (også NEGATIV = fradrag/rabatt) → beløpet er fastprisen, antall 1.
    if (fastpris !== 0) {
      unit_price = fastpris
      budget_quantity = 1
    } else if (pris2 === 1 && Math.abs(antall2) > 1) {
      // «Beløp i antall-kolonnen» (pris = 1) — tål negativt beløp (= fradrag).
      unit_price = antall2
      budget_quantity = 1
    } else {
      unit_price = pris2
      budget_quantity = antall2
    }
    if (product_code && isLumpSumCode(product_code)) {
      // Velg beløpet med STØRST absoluttverdi og BEHOLD fortegnet, slik at en
      // negativ fastpris (fradrag, f.eks. ULG39B −65 000) ikke blir til 0 av Math.max.
      budget_quantity = [fastpris, antall2, pris2].reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0)
      unit_price = 1
    }

    // Behold fradrags-/korreksjonslinjer (negativ verdi). Hopp KUN over rader uten
    // noen pris å verdsette. Den gamle regelen `<= 0` droppet også ALLE negative
    // linjer — det var nettopp det som lot fradrag (f.eks. −65 000) forsvinne stille.
    if (unit_price === 0) {
      skipped.push({ row: i + 1, code: product_code, name: product_name, reason: 'Mangler pris' })
      continue
    }

    lines.push({ product_code, product_name, unit_price, budget_quantity })
  }

  return { lines, skipped }
}
