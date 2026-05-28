export const MONTHS_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'] as const

export const MONTHS_FULL = [
  '', 'Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Desember',
] as const

export function fmtNOK(n: number): string {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(n)
}

export function fmtNumber(n: number, decimals = 0): string {
  return new Intl.NumberFormat('nb-NO', { maximumFractionDigits: decimals }).format(n)
}

export function fmtShort(n: number): string {
  if (n === 0) return '–'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} M`
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)} k`
  return String(Math.round(n))
}

/**
 * Canonical product label across the portal:
 *
 *   "UPFA2310 - Graving av grøft pr. meter"
 *
 * The `description` field on the products table is used as the product code
 * (e.g. "UPFA2310"). If a product has no code yet we fall back to just the
 * name so older rows still render cleanly.
 *
 * Use this from server endpoints when building `product_name` payloads so
 * every consumer (admin lists, sub views, PDF exports, invoice-basis) shows
 * the same string without needing to re-implement the join.
 */
export function fmtProductLabel(
  product: { name: string; description?: string | null } | null | undefined,
): string {
  if (!product) return '–'
  const code = product.description?.trim()
  if (!code) return product.name
  return `${code} - ${product.name}`
}

export function parseNorwegianNumber(input: string): number {
  const n = parseFloat(input.replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}
