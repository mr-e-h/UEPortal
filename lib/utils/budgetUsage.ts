import type { WeeklyReportLine, WeeklyReportStatus } from '@/types'

export interface BudgetUsage {
  approved: number
  pending: number
  remaining: number
  remainingApprovedOnly: number
}

export type LineWithReportStatus = WeeklyReportLine & { report_status: WeeklyReportStatus }

export function calculateBudgetUsage(
  budgetLineId: string,
  budgetQuantity: number,
  lines: LineWithReportStatus[],
  excludeReportId?: string
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

  return {
    approved,
    pending,
    remaining: budgetQuantity - approved - pending,
    remainingApprovedOnly: budgetQuantity - approved,
  }
}
