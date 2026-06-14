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

/**
 * Sluttmåned-indeksen åpne månedlige poster løper til: prosjektets sluttdato,
 * ellers inneværende måned (så et prosjekt uten sluttdato ikke gir uendelig sum).
 */
export function fallbackEndMonthIndex(projectEnd: string | null, now: Date): number {
  if (projectEnd) return mi(Number(projectEnd.slice(0, 4)), Number(projectEnd.slice(5, 7)))
  return now.getFullYear() * 12 + now.getMonth()
}
