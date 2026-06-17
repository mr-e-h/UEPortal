import type { ProjectInternalCostEntry } from '@/types'

/**
 * Interne kostnader på et prosjekt: ÉN kilde for hvordan engangs- og løpende
 * månedlige poster summeres, så hero, Kost-fanen, Oversikt og fane-tabellen
 * alltid viser samme totalsum.
 *
 *  - one_time: bidrar med beløpet sitt én gang.
 *  - monthly:  bidrar med beløpet PER måned fra startmåned til sluttmåned
 *    (inklusive). Mangler sluttmåned, løper den til `fallbackEndMi` — typisk
 *    prosjektets sluttmåned, ellers inneværende måned.
 *
 * En måned identifiseres som år×12 + (måned−1), 0-basert, så sammenligning blir
 * triviell (samme konvensjon som lib/resource-allocation.ts).
 */

const mi = (year: number, month: number) => year * 12 + (month - 1)

type CostShape = Pick<ProjectInternalCostEntry, 'recurrence' | 'year' | 'month' | 'end_year' | 'end_month'>

/** Antall måneder en post bidrar (one_time = 1, monthly = span, aldri < 1). */
export function internalCostMonths(entry: CostShape, fallbackEndMi: number): number {
  if (entry.recurrence !== 'monthly') return 1
  const startMi = mi(entry.year, entry.month)
  const endMi = entry.end_year != null && entry.end_month != null
    ? mi(entry.end_year, entry.end_month)
    : fallbackEndMi
  return Math.max(1, endMi - startMi + 1)
}

/** Utvidet beløp for én post = beløp × antall måneder. */
export function expandedInternalCost(entry: ProjectInternalCostEntry, fallbackEndMi: number): number {
  return (entry.amount ?? 0) * internalCostMonths(entry, fallbackEndMi)
}

/** Sum utvidet internkost over alle poster. */
export function internalCostTotal(entries: ProjectInternalCostEntry[], fallbackEndMi: number): number {
  return entries.reduce((s, e) => s + expandedInternalCost(e, fallbackEndMi), 0)
}

/** Måned-indeksen for "nå" — samme konvensjon som mi() (år×12 + måned−1, 0-basert). */
export const currentMonthIndex = (now: Date): number => now.getFullYear() * 12 + now.getMonth()

/**
 * Sluttmåned-indeksen åpne månedlige poster løper til: prosjektets sluttdato,
 * ellers inneværende måned (så et prosjekt uten sluttdato ikke gir uendelig sum).
 */
export function fallbackEndMonthIndex(projectEnd: string | null, now: Date): number {
  if (projectEnd) return mi(Number(projectEnd.slice(0, 4)), Number(projectEnd.slice(5, 7)))
  return currentMonthIndex(now)
}

/**
 * Antall måneder en post HAR påløpt per `nowMi` (faktisk forbruk hittil, ikke
 * hele planen):
 *   - one_time: 1 hvis posten har startet (måned ≤ nå), ellers 0.
 *   - monthly:  fra startmåned t.o.m. min(sluttmåned, nå). En åpen post regnes
 *     bare til og med inneværende måned; en post som ikke har startet ennå → 0.
 */
export function internalCostMonthsToDate(entry: CostShape, nowMi: number): number {
  if (entry.recurrence !== 'monthly') {
    return mi(entry.year, entry.month) <= nowMi ? 1 : 0
  }
  const startMi = mi(entry.year, entry.month)
  if (startMi > nowMi) return 0
  const endMi = entry.end_year != null && entry.end_month != null
    ? mi(entry.end_year, entry.end_month)
    : nowMi
  return Math.max(0, Math.min(endMi, nowMi) - startMi + 1)
}

/** Påløpt internkost per i dag = Σ beløp × antall påløpte måneder. */
export function internalCostToDate(entries: ProjectInternalCostEntry[], nowMi: number): number {
  return entries.reduce((s, e) => s + (e.amount ?? 0) * internalCostMonthsToDate(e, nowMi), 0)
}

/**
 * Beløpet ÉN intern-post bidrar med i måned `monthIdx` (0 hvis den ikke er
 * aktiv den måneden). Brukes til å plassere interne kostnader i sine FAKTISKE
 * måneder når prognosen genereres fra fremdriftsplanen.
 *   - one_time: hele beløpet i startmåneden, ellers 0.
 *   - monthly:  beløpet hver måned fra start t.o.m. slutt (åpen post = fra start
 *     og utover — kalleren begrenser horisonten).
 */
export function internalCostForMonth(entry: ProjectInternalCostEntry, monthIdx: number): number {
  const startMi = mi(entry.year, entry.month)
  if (entry.recurrence !== 'monthly') return startMi === monthIdx ? (entry.amount ?? 0) : 0
  if (monthIdx < startMi) return 0
  if (entry.end_year != null && entry.end_month != null) {
    return monthIdx <= mi(entry.end_year, entry.end_month) ? (entry.amount ?? 0) : 0
  }
  return entry.amount ?? 0
}

/**
 * Prosjektets FAKTISKE sluttdato slik FREMDRIFTSPLANEN sier det: seneste slutt
 * blant faser + milepæler (slutt mangler → bruk start). Brukes som "ut
 * prosjektet" for åpne løpende interne kostnader, så f.eks. riggplass regnes
 * over perioden man faktisk bruker — og oppdateres automatisk når man redigerer
 * varigheten i fremdriftsplanen. Faller tilbake til prosjektets egen sluttdato
 * når planen er tom (ingen faser/milepæler).
 */
export function planEndDate(
  phases: Array<{ start_date: string; end_date: string | null }>,
  milestones: Array<{ start_date: string; end_date: string | null }>,
  projectEnd: string | null,
): string | null {
  let max: string | null = null
  for (const p of phases) {
    const e = p.end_date ?? p.start_date
    if (e && (!max || e > max)) max = e
  }
  for (const m of milestones) {
    const e = m.end_date ?? m.start_date
    if (e && (!max || e > max)) max = e
  }
  return max ?? projectEnd
}
