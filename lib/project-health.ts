/**
 * Prosjekthelse for porteføljeoversikten: grønn (på plan) / gul (følg med) /
 * rød (forsinket). Den ENE tingen en oversikt skal svare på — er prosjektet
 * à jour? Bygger på fremdrift (volum) MOT tid brukt + ventende saker.
 *
 *   - rød:   forfalt (sluttdato passert, ikke ferdig) ELLER volum ligger ≥25
 *            %-poeng bak tidsforbruket.
 *   - gul:   ligger 10–25 %-poeng bak, ELLER har ventende saker (EM / rapport /
 *            sjekklistepunkt).
 *   - grønn: ellers (på eller foran skjema, ingen ventende saker).
 *
 * Mangler volumtall (ingen budsjettlinjer) kan vi ikke si «bak skjema», så da
 * styres helsen kun av forfall + ventende saker. Ikke-aktive prosjekter er
 * nøytrale (grønn).
 */

export type Health = 'green' | 'amber' | 'red'

export const HEALTH_LABEL: Record<Health, string> = {
  green: 'På plan',
  amber: 'Følg med',
  red: 'Forsinket',
}

export interface HealthInput {
  status: string
  /** Volumfremdrift 0–100, eller null når den ikke kan beregnes. */
  workProgress: number | null
  /** Tidsandel 0–100 (hvor langt i perioden), eller null uten datoer. */
  timeProgress: number | null
  endDate: string | null
  attentionTotal: number
  /** Dagens dato, YYYY-MM-DD. */
  today: string
}

export function projectHealth(i: HealthInput): Health {
  if (i.status !== 'active') return 'green'
  const overdue = !!i.endDate && i.endDate < i.today && (i.workProgress == null || i.workProgress < 100)
  const behind = i.workProgress != null && i.timeProgress != null ? i.timeProgress - i.workProgress : 0
  if (overdue || behind >= 25) return 'red'
  if (behind >= 10 || i.attentionTotal > 0) return 'amber'
  return 'green'
}

/** Sorteringsrang så de mest kritiske kommer øverst (rød > gul > grønn). */
export const HEALTH_RANK: Record<Health, number> = { red: 2, amber: 1, green: 0 }
