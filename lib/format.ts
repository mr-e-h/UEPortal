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

/* ── Datoformat-modulen ──────────────────────────────────────────────
   ÉN kilde for datovisning i hele portalen. Ikke lag lokale fmtDate-
   varianter i komponenter — importer herfra, så endres formatet alle
   steder samtidig. */

/** Kompakt tabell-/tidslinjeformat: «26.05.26». */
export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '–'
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

/**
 * Datospenn med punkt-semantikk: tom/lik sluttdato → kun én dato
 * («26.05.26»), ellers «26.05.26 – 26.10.26».
 */
export function fmtDateRange(start: string, end?: string | null): string {
  if (!end || end === start) return fmtDateShort(start)
  return `${fmtDateShort(start)} – ${fmtDateShort(end)}`
}

/** Leselig langformat: «26. mai 2026». */
export function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Dato + klokkeslett (Oslo): «26. mai 2026, 14:30». */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Oslo' })
    + ' ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
}

/** Akse-/etikettformat uten år: «26. mai». */
export function fmtDayMonth(iso: string | null | undefined): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' })
}

/** Anbudsfrist: «26. mai 2026 kl. 14:30», eller «Ingen frist». */
export function fmtDeadline(iso: string | null | undefined): string {
  if (!iso) return 'Ingen frist'
  const d = new Date(iso)
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Oslo' })
    + ' kl. ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
}

export function parseNorwegianNumber(input: string): number {
  const n = parseFloat(input.replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

/**
 * Kanonisk EM-tittel: "Endringsmelding 7 - Sentrumsgården".
 *
 * Nummeret er prosjekt-scopet (se assign_change_order_number-trigger), så
 * samme prosjekt får 1, 2, 3, ... uavhengig av UE. Brukes i admin- og
 * UE-lister, EM-detalj-header, PDF-eksport og varsler.
 */
export function fmtChangeOrderTitle(
  number: number | null | undefined,
  projectName: string | null | undefined,
): string {
  const n = number ?? '?'
  const proj = projectName?.trim() || '–'
  return `Endringsmelding ${n} - ${proj}`
}
