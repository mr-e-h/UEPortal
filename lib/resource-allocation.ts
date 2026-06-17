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
  /** Manuelle overstyringer (planned_hours) per prosjekt — låses (fordelt jevnt
   *  over prosjektets aktive måneder) og trekkes fra poolen; residualen deles på
   *  de ikke-overstyrte etter omsetning. Tom = ren omsetnings-vekt (som før). */
  overrides?: Map<string, number>,
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
  const avgCost = pool.hoursPerMonth > 0 ? pool.costPerMonth / pool.hoursPerMonth : 0

  months.forEach((col, ci) => {
    const active = projects.filter((p) => p.startMonth <= col.index && col.index <= p.endMonth)

    // Overstyrte prosjekter: fast andel (override / antall aktive måneder),
    // trekkes fra månedens pool. Residualen deles på de ikke-overstyrte.
    let usedHours = 0
    const free: ProjectSpan[] = []
    let freeRevenue = 0
    for (const p of active) {
      const override = overrides?.get(p.id)
      if (override != null) {
        const span = Math.max(1, p.endMonth - p.startMonth + 1)
        const h = override / span
        const ri = rowIndexById.get(p.id)
        if (ri !== undefined) {
          rows[ri].cellsHours[ci] = h
          rows[ri].cellsCost[ci] = h * avgCost
          rows[ri].totalHours += h
          rows[ri].totalCost += h * avgCost
        }
        usedHours += h
      } else {
        free.push(p)
        freeRevenue += (p.revenue ?? 0)
      }
    }

    const residual = Math.max(0, pool.hoursPerMonth - usedHours)
    for (const p of free) {
      const weight = freeRevenue > 0 ? (p.revenue ?? 0) / freeRevenue : 0
      const ri = rowIndexById.get(p.id)
      if (ri === undefined) continue
      const h = residual * weight
      rows[ri].cellsHours[ci] = h
      rows[ri].cellsCost[ci] = h * avgCost
      rows[ri].totalHours += h
      rows[ri].totalCost += h * avgCost
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

/**
 * Fordel den månedlige ressurspoolen på prosjekter, vektet på hvert prosjekts
 * MÅNEDLIGE omsetning (ikke total), over horisonten [startMonth, endMonth].
 *
 * monthlyRevenueByProject: projectId → (monthIndex → revenue)
 *   Må inneholde alle aktive prosjekter for at vektingen skal bli riktig.
 *
 * Returnerer: projectId → (monthIndex → { hours, cost })
 *   Kun måneder der prosjektet faktisk får tildelt > 0 er inkludert i den
 *   indre mapen — men kallere kan trygt slå opp med ?? { hours: 0, cost: 0 }.
 *
 * Ingen deling på 0: måneder der totalRevenue for alle prosjekter = 0 gir
 * alle prosjekter hours = 0 og cost = 0 (ikke inkludert i resultatet).
 */
export function allocatePoolByMonthlyRevenue(
  monthlyRevenueByProject: Map<string, Map<number, number>>,
  pool: MonthlyPool,
  startMonth: number,
  endMonth: number,
  /**
   * Manuelle overstyringer (planned_hours) per prosjekt — KUN prosjekter som er
   * satt. Et overstyrt prosjekt LÅSES til sin verdi: timene fordeles på dets egne
   * aktive måneder etter omsetning (summen = overstyringen), og trekkes fra
   * månedens pool. RESIDUALEN (pool − Σ overstyrt denne måneden) deles på de
   * IKKE-overstyrte etter månedlig omsetning. Måneder uten overstyrte prosjekter
   * gir hele poolen til de andre. Tom map = dagens oppførsel (rein omsetnings-vekt).
   */
  overridesByProject?: Map<string, number>,
): Map<string, Map<number, { hours: number; cost: number }>> {
  const result = new Map<string, Map<number, { hours: number; cost: number }>>()
  const avgCost = pool.hoursPerMonth > 0 ? pool.costPerMonth / pool.hoursPerMonth : 0

  // Total omsetning per prosjekt — for å fordele en TOTAL overstyring per måned.
  const totalRevByProject = new Map<string, number>()
  for (const [pid, byMonth] of Array.from(monthlyRevenueByProject.entries())) {
    let t = 0
    for (const v of Array.from(byMonth.values())) t += v
    totalRevByProject.set(pid, t)
  }

  const setCell = (pid: string, mi: number, hours: number) => {
    if (hours <= 0) return
    let inner = result.get(pid)
    if (!inner) { inner = new Map(); result.set(pid, inner) }
    inner.set(mi, { hours, cost: hours * avgCost })
  }

  for (let mi = startMonth; mi <= endMonth; mi++) {
    // 1. Overstyrte prosjekter: fast andel av egen overstyring (fordelt per måned
    //    etter omsetning), trekkes fra månedens pool.
    let usedHours = 0
    const free: string[] = []
    let freeRevDenom = 0
    for (const [pid, revByMonth] of Array.from(monthlyRevenueByProject.entries())) {
      const revM = revByMonth.get(mi) ?? 0
      if (revM <= 0) continue
      const override = overridesByProject?.get(pid)
      if (override != null) {
        const totalRev = totalRevByProject.get(pid) ?? 0
        const oHours = totalRev > 0 ? override * (revM / totalRev) : 0
        setCell(pid, mi, oHours)
        usedHours += oHours
      } else {
        free.push(pid)
        freeRevDenom += revM
      }
    }
    // 2. Residual til de ikke-overstyrte, vektet på månedlig omsetning.
    const residual = Math.max(0, pool.hoursPerMonth - usedHours)
    if (residual > 0 && freeRevDenom > 0) {
      for (const pid of free) {
        const revM = monthlyRevenueByProject.get(pid)?.get(mi) ?? 0
        setCell(pid, mi, residual * (revM / freeRevDenom))
      }
    }
  }

  return result
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
