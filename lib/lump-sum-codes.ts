// Lump-sum product codes: qty = max(fastpris, antall2, pris2), unit_price = 1.
// Kept as a const because lib/excel.ts is hot-path import parsing and stays
// synchronous. Mirror in data/lump_sum_codes.json + the lump_sum_codes table
// is kept for admin visibility — edit both places if codes change.
const LUMP_SUM_CODES = new Set<string>([
  'U0000', 'U0000A', 'U0000B', 'U0000C',
  'ULG39A', 'ULG39B', 'ULG39C', 'ULG39D',
  'CDM0001', 'CMD0001',
  'ULG17', 'ULG17A', 'ULG17B', 'ULG17C',
])

export function isLumpSumCode(code: string): boolean {
  return LUMP_SUM_CODES.has(code)
}

export function getLumpSumCodes(): Set<string> {
  return LUMP_SUM_CODES
}
