/**
 * Oppmerksomhets-modulen: ÉN definisjon av hva som «krever handling».
 * Brukes av dashbordkøene, prosjektkortene og prosjekt-heroen — endres
 * definisjonen her, følger alle tellinger og køer med.
 */

/**
 * Ukesrapporter som venter på behandling. 'partially_approved' er IKKE
 * ferdig — noen linjer trenger ny vurdering, så den blir liggende i køen
 * til resten er godkjent eller avvist.
 */
export const WR_NEEDS_ACTION = ['submitted', 'partially_approved'] as const

/** Endringsmeldinger som venter på behandling. */
export const EM_NEEDS_ACTION = ['pending'] as const

export function wrNeedsAction(status: string): boolean {
  return (WR_NEEDS_ACTION as readonly string[]).includes(status)
}

export function emNeedsAction(status: string): boolean {
  return (EM_NEEDS_ACTION as readonly string[]).includes(status)
}

/**
 * EM-er admin har sendt tilbake til UE for retting. I motsetning til de to
 * over (som venter på *admin*) er dette UEs egen oppgave — den telles separat
 * så lister/bannere kan skille «venter på admin» fra «krever din handling».
 */
export function emNeedsRevision(status: string): boolean {
  return status === 'revision_requested'
}

/** Per-prosjekt-tellingene som vises på prosjektkort og i bannere. */
export interface AttentionCounts {
  change_orders: number
  weekly_reports: number
  open_tasks: number
  total: number
}

export function attentionCounts({
  changeOrders,
  weeklyReports,
  openTasks,
}: {
  changeOrders: number
  weeklyReports: number
  openTasks: number
}): AttentionCounts {
  return {
    change_orders: changeOrders,
    weekly_reports: weeklyReports,
    open_tasks: openTasks,
    total: changeOrders + weeklyReports + openTasks,
  }
}
