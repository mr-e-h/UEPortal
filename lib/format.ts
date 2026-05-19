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

export function parseNorwegianNumber(input: string): number {
  const n = parseFloat(input.replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}
