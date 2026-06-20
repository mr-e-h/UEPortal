import type { WeeklyReportLine, WeeklyReportStatus } from '@/types'

export interface BudgetUsage {
  approved: number
  pending: number
  /** Σ produksjonsføringer (no-cost / egenprod) på denne linja — talt som utført
   *  STRAKS, uavhengig av UE-rapportering. 0 når ingen føringer er sendt med. */
  producedNoCost: number
  /** approved + producedNoCost — total faktisk utført mengde på linja. */
  totalExecuted: number
  /** totalExecuted − budsjettmengde. Positiv = overprodusert mot budsjett. */
  diffQuantity: number
  remaining: number
  remainingApprovedOnly: number
}

export type LineWithReportStatus = WeeklyReportLine & { report_status: WeeklyReportStatus }

/** Strukturelt minimum av en produksjonsføring for budsjettbruk-regningen. */
export type ProductionEntryForUsage = {
  project_budget_line_id: string | null
  quantity: number
}

export function calculateBudgetUsage(
  budgetLineId: string,
  budgetQuantity: number,
  lines: LineWithReportStatus[],
  excludeReportId?: string,
  productionEntries: ProductionEntryForUsage[] = []
): BudgetUsage {
  const relevant = lines.filter(
    (l) =>
      l.project_budget_line_id === budgetLineId &&
      l.weekly_report_id !== excludeReportId
  )

  const approved = relevant
    .filter((l) => l.status === 'approved')
    .reduce((s, l) => s + l.reported_quantity, 0)

  // Only count pending lines whose parent report has been submitted for review.
  // Draft lines also carry status 'pending' but must not be counted here.
  const pending = relevant
    .filter(
      (l) =>
        l.status === 'pending' &&
        (l.report_status === 'submitted' || l.report_status === 'partially_approved')
    )
    .reduce((s, l) => s + l.reported_quantity, 0)

  // Produksjonsføringer (no-cost / egenprod) på denne linja — utført STRAKS.
  // Bakoverkompatibelt: tom default ⇒ 0, så remaining/tallene er uendret når
  // ingen føringer sendes med.
  const producedNoCost = productionEntries
    .filter((e) => e.project_budget_line_id === budgetLineId)
    .reduce((s, e) => s + (e.quantity ?? 0), 0)

  const totalExecuted = approved + producedNoCost

  return {
    approved,
    pending,
    producedNoCost,
    totalExecuted,
    diffQuantity: totalExecuted - budgetQuantity,
    remaining: budgetQuantity - approved - pending - producedNoCost,
    remainingApprovedOnly: budgetQuantity - approved,
  }
}
