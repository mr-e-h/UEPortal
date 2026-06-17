import type { ProjectInternalCostEntry } from '@/types'
import { monthIndexFromISO } from './resource-allocation'
import { internalCostForMonth } from './internal-costs'

/**
 * Prognose-synergien: fordel prosjektets BUDSJETT-totaler (inntekt + UE-kost)
 * utover månedene FREMDRIFTSPLANEN sier, vektet per fase — så man får et riktig
 * prognosebilde uten å legge inn tall måned for måned.
 *
 * Modell:
 *  - Hver fase har en vekt (manuell, eller "auto" = fasens varighet i måneder).
 *  - Inntekt og UE-kost splittes på fasene proporsjonalt med vekt, og spres
 *    JEVNT over månedene hver fase varer (inklusiv start/slutt).
 *  - Internkost legges i sine FAKTISKE måneder (engang i sin måned, løpende per
 *    måned) — de har allerede egen tidsplassering, så de vektes ikke.
 *
 * Måned = år×12 + (måned−1), samme konvensjon som resten av kodebasen.
 * Rene funksjoner — ingen I/O — så de er trivielle å teste og dele.
 */

export interface PhaseSpanWeight {
  start_date: string
  end_date: string | null
  /** Manuell vekt (override). */
  weight: number | null
  /**
   * Avledet vekt fra budsjettlinjer tagget til fasen (kr) — se ØKONOMIMODELL.md 1b.
   *   null = ingen tagging i bruk → fall tilbake til fasens varighet.
   *   0    = tagging i bruk, men denne fasen har ingen linjer → 0 andel.
   */
  derivedWeight?: number | null
}

export interface MonthForecast {
  /** år×12 + (måned−1). */
  mi: number
  year: number
  /** 1–12. */
  month: number
  revenue: number
  ueCost: number
  internalCost: number
}

/** Antall måneder en fase dekker (inklusiv start/slutt; punktfase = 1). */
export function phaseMonthSpan(p: { start_date: string; end_date: string | null }): number {
  const s = monthIndexFromISO(p.start_date)
  const e = p.end_date ? monthIndexFromISO(p.end_date) : s
  return Math.max(1, e - s + 1)
}

/**
 * Effektiv vekt, i prioritert rekkefølge:
 *   1. manuell vekt (override) hvis satt (> 0)
 *   2. avledet vekt fra budsjettlinjer (også 0, når tagging er i bruk)
 *   3. fasens varighet (fallback når ingen tagging finnes)
 */
export function phaseEffectiveWeight(p: PhaseSpanWeight): number {
  if (p.weight != null && p.weight > 0) return p.weight
  if (p.derivedWeight != null) return p.derivedWeight
  return phaseMonthSpan(p)
}

/**
 * Bygg den månedlige prognosen fra fremdriftsplanen + budsjett-totalene.
 * Returnerer en map "år-måned" → fordelte tall. Måneder uten aktivitet mangler
 * i mappen (kalleren behandler dem som 0).
 */
export function distributeForecastFromPhases({
  phases,
  budgetRevenue,
  budgetCost,
  internalCosts,
}: {
  phases: PhaseSpanWeight[]
  budgetRevenue: number
  budgetCost: number
  internalCosts: ProjectInternalCostEntry[]
}): Map<string, MonthForecast> {
  const out = new Map<string, MonthForecast>()
  const bump = (mi: number, field: 'revenue' | 'ueCost' | 'internalCost', v: number) => {
    if (!v) return
    const year = Math.floor(mi / 12)
    const month = (mi % 12) + 1
    const key = `${year}-${month}`
    const cur = out.get(key) ?? { mi, year, month, revenue: 0, ueCost: 0, internalCost: 0 }
    cur[field] += v
    out.set(key, cur)
  }

  // Inntekt + UE-kost: split på faser etter vekt, spre jevnt over fasens måneder.
  const totalWeight = phases.reduce((s, p) => s + phaseEffectiveWeight(p), 0)
  if (totalWeight > 0) {
    for (const p of phases) {
      const share = phaseEffectiveWeight(p) / totalWeight
      const s = monthIndexFromISO(p.start_date)
      const e = p.end_date ? monthIndexFromISO(p.end_date) : s
      const months = Math.max(1, e - s + 1)
      const revPerMonth = (budgetRevenue * share) / months
      const costPerMonth = (budgetCost * share) / months
      for (let mi = s; mi <= e; mi++) {
        bump(mi, 'revenue', revPerMonth)
        bump(mi, 'ueCost', costPerMonth)
      }
    }
  }

  // Internkost: plasser hver post i sine faktiske måneder, begrenset til
  // fremdriftsplanens spenn (så åpne løpende poster ikke løper i det uendelige).
  if (phases.length > 0 && internalCosts.length > 0) {
    let minMi = Infinity
    let maxMi = -Infinity
    for (const p of phases) {
      const s = monthIndexFromISO(p.start_date)
      const e = p.end_date ? monthIndexFromISO(p.end_date) : s
      if (s < minMi) minMi = s
      if (e > maxMi) maxMi = e
    }
    for (let mi = minMi; mi <= maxMi; mi++) {
      let ic = 0
      for (const entry of internalCosts) ic += internalCostForMonth(entry, mi)
      bump(mi, 'internalCost', ic)
    }
  }

  return out
}
