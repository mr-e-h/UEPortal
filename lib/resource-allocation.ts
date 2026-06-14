import type { InternalResource } from '@/types'

/**
 * Ressursfordelings-modulen: rene funksjoner som sprer den interne
 * ressurspoolen utover MÅNEDER, og innen hver måned utover de prosjektene som
 * er aktive den måneden, vektet på omsetning.
 *
 * Modell:
 *  - Hver ressurs har en månedskapasitet (timer per måned) + timeskost.
 *  - Poolens månedskapasitet = Σ timer/mnd, og månedskostnad = Σ(timer/mnd ×
 *    timeskost).
 *  - For hver måned i horisonten fordeles poolen på prosjektene som er aktive
 *    den måneden (aktiv = prosjektets span dekker måneden), vektet på
 *    omsetning. Prosjekter med 0 omsetning (eller måneder uten aktive
 *    prosjekter) gir andel 0 — ingen deling på null.
 *
 * En måned identifiseres som et heltall = år×12 + månedindeks (0 = januar), så
 * sammenligning og iterasjon blir triviell.
 */

const MONTHS_NB = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']

/** År×12 + 0-basert månedindeks fra en ISO-dato (YYYY-MM-..). */
export function monthIndexFromISO(iso: string): number {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7)) - 1
  return y * 12 + m
}

export function monthIndexNow(now: Date): number {
  return now.getFullYear() * 12 + now.getMonth()
}

export interface MonthlyPool {
  hoursPerMonth: number
  costPerMonth: number
}

export function monthlyPool(resources: Pick<InternalResource, 'hours_per_month' | 'hourly_cost'>[]): MonthlyPool {
  let hoursPerMonth = 0
  let costPerMonth = 0
  for (const r of resources) {
    const h = r.hours_per_month ?? 0
    hoursPerMonth += h
    costPerMonth += h * (r.hourly_cost ?? 0)
  }
  return { hoursPerMonth, costPerMonth }
}

export interface ProjectSpan {
  id: string
  name: string
  revenue: number
  /** Inklusiv start-/sluttmåned (år×12 + månedindeks). */
  startMonth: number
  endMonth: number
}

export interface MonthCol {
  index: number
  year: number
  /** 0-basert månedindeks. */
  month: number
  label: string
}

export interface GridRow {
  id: string
  name: string
  revenue: number
  startMonth: number
  endMonth: number
  cellsHours: number[]
  cellsCost: number[]
  totalHours: number
  totalCost: number
}

export interface MonthGrid {
  months: MonthCol[]
  rows: GridRow[]
  hoursPerMonth: number
  costPerMonth: number
}

/**
 * Bygg måneds-rutenettet fra prosjekt-span + pool over [startMonth, endMonth]
 * (begge inklusive). Hver rad svarer til ett prosjekt, hver kolonne til én
 * måned; cellen er timene/kostnaden prosjektet får den måneden.
 */
export function buildMonthGrid(
  projects: ProjectSpan[],
  pool: MonthlyPool,
  startMonth: number,
  endMonth: number,
): MonthGrid {
  const months: MonthCol[] = []
  for (let m = startMonth; m <= endMonth; m++) {
    months.push({ index: m, year: Math.floor(m / 12), month: m % 12, label: MONTHS_NB[m % 12] })
  }

  const rows: GridRow[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    revenue: p.revenue,
    startMonth: p.startMonth,
    endMonth: p.endMonth,
    cellsHours: new Array(months.length).fill(0),
    cellsCost: new Array(months.length).fill(0),
    totalHours: 0,
    totalCost: 0,
  }))
  const rowIndexById = new Map(projects.map((p, i) => [p.id, i]))

  months.forEach((col, ci) => {
    const active = projects.filter((p) => p.startMonth <= col.index && col.index <= p.endMonth)
    const totalRevenue = active.reduce((s, p) => s + (p.revenue ?? 0), 0)
    for (const p of active) {
      const weight = totalRevenue > 0 ? (p.revenue ?? 0) / totalRevenue : 0
      const ri = rowIndexById.get(p.id)
      if (ri === undefined) continue
      const h = pool.hoursPerMonth * weight
      const c = pool.costPerMonth * weight
      rows[ri].cellsHours[ci] = h
      rows[ri].cellsCost[ci] = c
      rows[ri].totalHours += h
      rows[ri].totalCost += c
    }
  })

  return { months, rows, hoursPerMonth: pool.hoursPerMonth, costPerMonth: pool.costPerMonth }
}

type DateRange = { start_date: string | null; end_date: string | null }

/**
 * Et prosjekts aktive span = første start → siste slutt på tvers av
 * fremdriftsplanen (faser + milepæler). En milepæl uten sluttdato er et
 * punktevent (teller på startdatoen). Faller tilbake til prosjektets egne
 * start-/sluttdatoer når planen er tom. null = ingen datoer i det hele tatt.
 *
 * Delt mellom Ressurser-siden (estimat-rutenett) og Totaløkonomi (fordeling av
 * faktisk internkost) så begge bruker nøyaktig samme span-definisjon.
 */
export function computeSpanISO(
  project: { start_date: string | null; end_date: string | null },
  phases: DateRange[],
  milestones: DateRange[],
): { start: string; end: string } | null {
  const starts: string[] = []
  const ends: string[] = []
  for (const row of [...phases, ...milestones]) {
    if (row.start_date) {
      starts.push(row.start_date)
      ends.push(row.end_date ?? row.start_date)
    }
  }
  if (starts.length === 0) {
    if (project.start_date) return { start: project.start_date, end: project.end_date ?? project.start_date }
    return null
  }
  return {
    start: starts.reduce((a, b) => (a < b ? a : b)),
    end: ends.reduce((a, b) => (a > b ? a : b)),
  }
}

/** Én avstemt måned: faktisk internkost (timer × snittkost) for måneden. */
export interface MonthlyActual {
  year: number
  /** 1–12. */
  month: number
  cost: number
}

/**
 * Fordel FAKTISK internkost (per avstemt måned) på prosjektene som var aktive
 * den måneden, vektet på omsetning — nøyaktig samme vekting som estimat-
 * rutenettet (buildMonthGrid). En måned uten aktive prosjekter, eller der alle
 * aktive har 0 omsetning, allokeres ikke (vekt 0, som i estimatet).
 *
 * Returnerer kost per prosjekt-id + sum faktisk allokert.
 */
export function allocateActualInternalCost(
  actuals: MonthlyActual[],
  projects: ProjectSpan[],
): { byProject: Map<string, number>; total: number } {
  const byProject = new Map<string, number>()
  let total = 0
  for (const a of actuals) {
    if (a.cost <= 0) continue
    const mi = a.year * 12 + (a.month - 1)
    const active = projects.filter((p) => p.startMonth <= mi && mi <= p.endMonth)
    const totalRevenue = active.reduce((s, p) => s + (p.revenue ?? 0), 0)
    if (totalRevenue <= 0) continue
    for (const p of active) {
      const c = a.cost * ((p.revenue ?? 0) / totalRevenue)
      if (c <= 0) continue
      byProject.set(p.id, (byProject.get(p.id) ?? 0) + c)
      total += c
    }
  }
  return { byProject, total }
}
