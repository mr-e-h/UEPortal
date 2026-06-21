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

/**
 * Strukturelt minimum av en produksjonsføring (migrasjon 0018) for
 * økonomiberegning. Knyttet til en budsjettlinje teller mengden opptjent STRAKS
 * mot kunde via linjas customer_price_snapshot. cost/UE-kost holdes adskilt og
 * rører IKKE ueReportedCost i v1.
 */
export interface ProductionEntryForEconomy {
  project_budget_line_id: string | null
  quantity: number
}

export interface ProjectEconomySummary {
  originalBudget: number
  totalContract: number
  approvedEMValue: number
  pendingEMValue: number
  approvedEMCount: number
  pendingEMCount: number
  /** Opptjent (rå): godkjente rapportlinjer × kundepris, UKLAMPET — den faktiske
   *  omsetningsverdien hittil. `delivered` er den samme verdien klampet til
   *  totalContract for fremdriftsbaren; bruk `opptjent` til resultat-regnskap. */
  opptjent: number
  delivered: number
  pendingDelivery: number
  remaining: number
  progressPct: number
  overBudget: boolean
  pendingReports: number
  ueBudgetCost: number
  ueReportedCost: number
  internCost: number
  /** Materiellbudsjettets ordreverdi (Σ planlagt × pris) — inngår i totalContract. */
  materialOrderValue: number
  /** Faktisk materiellkost så langt (Σ avstemt faktisk × pris) — påløper ved avstemming. */
  materialReconciledCost: number
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
  productionEntries = [],
  materialOrderValue = 0,
  materialReconciledValue = 0,
  materialReconciledCost = 0,
}: {
  budgetLines: ProjectBudgetLine[]
  weeklyReports: ReportWithLines[]
  changeOrders: ChangeOrder[]
  /** Ferdig utvidet internkost (engang + løpende månedlig) — se lib/internal-costs.ts. */
  internalCostTotal: number
  /**
   * Registrerte produksjonsføringer (migrasjon 0018). Knyttet til en
   * budsjettlinje teller mengden opptjent STRAKS mot kunde (× linjas
   * customer_price_snapshot). Valgfri (default []) ⇒ tall UENDRET når ingen
   * føringer finnes. cost/UE-kost rører IKKE ueReportedCost i v1.
   */
  productionEntries?: ProductionEntryForEconomy[]
  /** Materiellbudsjettets ordreverdi (Σ planlagt antall × pris) — LEGGES TIL ordreverdi. */
  materialOrderValue?: number
  /** Ordreverdien til AVSTEMTE materiell-linjer (Σ planlagt × pris der reconciled) —
   *  teller som opptjent (levert) når materiellet er avstemt. */
  materialReconciledValue?: number
  /** Faktisk materiellkost (Σ avstemt faktisk antall × pris) — påløper FØRST ved avstemming. */
  materialReconciledCost?: number
}): ProjectEconomySummary {
  // Opprinnelig ordrebok (salgsverdi mot kunde — det er kontrakten).
  const originalBudget = budgetSalesValue(budgetLines)

  // Godkjente EM-er øker kontraktsverdien; ventende er IKKE bindende ennå,
  // men trengs for «krever oppmerksomhet» og EM-netto-konteksten.
  const approvedEMs = changeOrders.filter((co) => co.status === 'approved')
  const pendingEMs = changeOrders.filter((co) => co.status === 'pending')
  const approvedEMValue = emCustomerValue(approvedEMs)
  const pendingEMValue = emCustomerValue(pendingEMs)

  // Ordreverdi = arbeid (ordrebok) + godkjente EM + materiellbudsjett. Materiellet
  // legges til kontrakten; kosten realiseres FØRST når materiellet avstemmes.
  const totalContract = originalBudget + approvedEMValue + materialOrderValue

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

  // Produksjonsføringer (migrasjon 0018): knyttet til en budsjettlinje teller
  // mengden opptjent STRAKS mot kunde via linjas customer_price_snapshot — 0 kr
  // UE-kost ⇒ bedre margin. Tom default ⇒ ingen endring i tallene. Føringer uten
  // budsjettlinje (project_budget_line_id = null) ignoreres her, da de ikke har
  // en kundepris å verdsette mot.
  for (const entry of productionEntries) {
    if (!entry.project_budget_line_id) continue
    const price = blPriceMap.get(entry.project_budget_line_id) ?? 0
    deliveredValue += (entry.quantity ?? 0) * price
  }

  // Avstemt materiell teller som opptjent (levert) — ordreverdien til de avstemte
  // linjene realiseres. Den faktiske kosten kommer via materialReconciledCost.
  deliveredValue += materialReconciledValue

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
  const expectedProfit = totalContract - ueBudgetCost - internCost - materialReconciledCost

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
    opptjent: deliveredValue,
    delivered,
    pendingDelivery,
    remaining,
    progressPct,
    overBudget,
    pendingReports,
    ueBudgetCost,
    ueReportedCost,
    internCost,
    materialOrderValue,
    materialReconciledCost,
    expectedProfit,
  }
}
