import { readJson } from '@/lib/data'

let cachedSet: Set<string> | null = null

export function getLumpSumCodes(): Set<string> {
  if (cachedSet) return cachedSet
  const codes = readJson<string>('lump_sum_codes.json')
  cachedSet = new Set(codes)
  return cachedSet
}

export function isLumpSumCode(code: string): boolean {
  return getLumpSumCodes().has(code)
}
