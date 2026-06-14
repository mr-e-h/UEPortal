import type { ChangeOrder, ProjectBudgetLine } from '@/types'
import { wrNeedsAction } from '@/lib/attention'

/**
 * Prosjektøkonomi-modulen: ÉN kilde for økonomiformlene som før var
 * copy-pastet i hero, API-ruter og seksjoner. Rene funksjoner over typede
 * rader — brukes både server- og klientside.
 *
 * Formlene er flyttet VERBATIM fra ProjectStatusHero / projects-rutene,
 * så tallene er identiske med før.
 */

type BudgetLineLike = Pick<ProjectBudgetLine, 'budget_quantity' | 'customer_price_snapshot' | 'subcontractor_cost_price_snapshot'>

/** Ordrebok mot kunde: Σ mengde × kundepris-snapshot. */
export function budgetSalesValue(lines: BudgetLineLike[]): number {
  return lines.reduce((s, bl) => s + (bl.budget_quantity ?? 0) * (bl.customer_price_snapshot ?? 0), 0)
}

/** Budsjettert UE-kost: Σ mengde × UE-kostpris-snapshot. */
export function budgetCostValue(lines: BudgetLineLike[]): number {
  return lines.reduce((s, bl) => s + (bl.budget_quantity ?? 0) * (bl.subcontractor_cost_price_snapshot ?? 0), 0)
}

type EmLike = Pick<ChangeOrder, 'total_customer_value' | 'total_cost'>

/** Sum kundeverdi på EM-er (f.eks. godkjente). */
export function emCustomerValue(changeOrders: EmLike[]): number {
  return changeOrders.reduce((s, co) => s + (co.total_customer_value ?? 0), 0)
}

/** Sum UE-kost på EM-er. */
export function emCost(changeOrders: EmLike[]): number {
  return changeOrders.reduce((s, co) => s + (co.total_cost ?? 0), 0)
}

/** Strukturelt minimum av en ukesrapport for økonomiberegning. */
export interface ReportWithLines {
  status: string
  lines: Array<{
    project_budget_line_id: string
    reported_quantity: number
    status: string
  }>
}

export interface ProjectEconomySummary {
  originalBudget: number
  totalContract: number
  approvedEMValue: number
  pendingEMValue: number
  approvedEMCount: number
  pendingEMCount: number
  delivered: number
  pendingDelivery: number
  remaining: number
  progressPct: number
  overBudget: boolean
  pendingReports: number
  ueBudgetCost: number
  ueReportedCost: number
  internCost: number
  expectedProfit: number
}

/**
 * Hele prosjektøkonomi-bildet (hero-en på prosjektsiden):
 *   - Hva er totalen?  (totalContract = ordrebok + godkjente EM-er)
 *   - Hva er gjort?    (delivered = godkjente rapportlinjer × kundepris)
 *   - Hva er igjen?    (remaining = total − levert − til godkjenning)
 *   - EM-bildet        (godkjent/ventende verdi + antall)
 *   - Kost/fortjeneste (UE-kost budsjett/rapportert, internkost, forventet)
 */
export function computeProjectEconomy({
  budgetLines,
  weeklyReports,
  changeOrders,
  internalCostTotal,
}: {
  budgetLines: ProjectBudgetLine[]
  weeklyReports: ReportWithLines[]
  changeOrders: ChangeOrder[]
  /** Ferdig utvidet internkost (engang + løpende månedlig) — se lib/internal-costs.ts. */
  internalCostTotal: number
}): ProjectEconomySummary {
  // Opprinnelig ordrebok (salgsverdi mot kunde — det er kontrakten).
  const originalBudget = budgetSalesValue(budgetLines)

  // Godkjente EM-er øker kontraktsverdien; ventende er IKKE bindende ennå,
  // men trengs for «krever oppmerksomhet» og EM-netto-konteksten.
  const approvedEMs = changeOrders.filter((co) => co.status === 'approved')
  const pendingEMs = changeOrders.filter((co) => co.status === 'pending')
  const approvedEMValue = emCustomerValue(approvedEMs)
  const pendingEMValue = emCustomerValue(pendingEMs)

  const totalContract = originalBudget + approvedEMValue

  // Levert = godkjente rapportlinjer × kundepris-snapshot (samme enhet som
  // ordreverdien, så fremdriftsbaren viser omsetningsverdi).
  const blPriceMap = new Map(budgetLines.map((bl) => [bl.id, bl.customer_price_snapshot ?? 0]))
  let deliveredValue = 0
  let pendingDeliveryValue = 0
  for (const report of weeklyReports) {
    for (const line of report.lines) {
      const price = blPriceMap.get(line.project_budget_line_id) ?? 0
      const lineValue = line.reported_quantity * price
      // En linje teller som «levert» kun når linja selv er godkjent.
      if (line.status === 'approved') {
        deliveredValue += lineValue
      } else if (report.status === 'submitted' || line.status === 'pending') {
        pendingDeliveryValue += lineValue
      }
    }
  }

  // Ventende rapporter telles på rapportnivå — banneret trenger et tall et
  // menneske kan skanne, ikke «47 linjer venter». Samme «krever handling»-
  // definisjon som dashbordet og prosjektkortene (lib/attention.ts).
  const pendingReports = weeklyReports.filter((r) => wrNeedsAction(r.status)).length

  // UE-kost + forventet fortjeneste.
  const ueLines = budgetLines.filter(
    (bl) => bl.assigned_subcontractor_id && bl.assigned_subcontractor_id !== '__intern__',
  )
  const ueBudgetCost = budgetCostValue(ueLines)
  const ueLineIds = new Set(ueLines.map((bl) => bl.id))
  const blCostMap = new Map(budgetLines.map((bl) => [bl.id, bl.subcontractor_cost_price_snapshot ?? 0]))
  let ueReportedCost = 0
  for (const report of weeklyReports) {
    if (report.status !== 'approved' && report.status !== 'partially_approved') continue
    for (const line of report.lines) {
      if (line.status === 'approved' && ueLineIds.has(line.project_budget_line_id)) {
        ueReportedCost += line.reported_quantity * (blCostMap.get(line.project_budget_line_id) ?? 0)
      }
    }
  }
  const internCost = internalCostTotal
  const expectedProfit = totalContract - ueBudgetCost - internCost

  // Bar-segmenter (klemt til en fornuftig stabling).
  const delivered = Math.min(deliveredValue, totalContract)
  const pendingDelivery = Math.min(pendingDeliveryValue, Math.max(0, totalContract - delivered))
  const remaining = Math.max(0, totalContract - delivered - pendingDelivery)

  const progressPct = totalContract > 0 ? Math.round((delivered / totalContract) * 100) : 0
  const overBudget = delivered > totalContract

  return {
    originalBudget,
    totalContract,
    approvedEMValue,
    pendingEMValue,
    approvedEMCount: approvedEMs.length,
    pendingEMCount: pendingEMs.length,
    delivered,
    pendingDelivery,
    remaining,
    progressPct,
    overBudget,
    pendingReports,
    ueBudgetCost,
    ueReportedCost,
    internCost,
    expectedProfit,
  }
}
