'use client'

import { useMemo, useState } from 'react'
import { fmtNOK as fmt, fmtProductLabel } from '@/lib/format'
import ProjectSetupCard from './ProjectSetupCard'
import InternalCostsSummaryCard from './InternalCostsSummaryCard'
import InvoicingSummaryCard from './InvoicingSummaryCard'
import PhasesMiniStrip from './PhasesMiniStrip'
import type {
  ProjectBudgetLine,
  ProjectSubcontractor,
  Subcontractor,
  ProjectInternalCostEntry,
  GanttMilestone,
  Product,
  WeeklyReport,
  WeeklyReportLine,
  ProjectInvoice,
  ProductionEntry,
} from '@/types'

type WRWithLines = WeeklyReport & { lines: WeeklyReportLine[] }

interface Props {
  projectId: string
  projectStart: string | null
  projectEnd: string | null
  /** Manuell overstyring av tiltenkte timer (null = bruk beregnet). */
  plannedHoursOverride: number | null
  /** Ordreverdi (salgsverdi + godkjente EM) — referanse for fakturering. */
  orderValue: number
  onOpenFremdriftsplan: () => void
  onOpenInternalCosts: () => void
  onOpenInvoices: () => void
  /** Fakturaer fra useProjectData (delt kilde med heroen). */
  invoices: ProjectInvoice[]
  /** Fra useProjectData — samme objekt Gantt-en på Fremdriftsplan-fanen får. */
  milestones: GanttMilestone[]
  budgetLines: ProjectBudgetLine[]
  internalCosts: ProjectInternalCostEntry[]
  /** Ferdig utvidet internkost-total (engang + løpende), regnet i forelderen. */
  totalInternalCost: number
  allProducts: Product[]
  allSubs: Subcontractor[]
  projectSubs: ProjectSubcontractor[]
  weeklyReportsWL: WRWithLines[]
  /** Produksjonsføringer (migrasjon 0018) — gir «utført uten kost»-mengde per linje. */
  productionEntries: ProductionEntry[]
  /** Legg til UE (ett-klikks, id direkte) + fjern via bekreftelse — fra forelder. */
  onAddSub: (subId: string) => Promise<void> | void
  onRequestRemoveSub: (linkId: string) => void
  /** Re-hent etter at oppsett (timer tiltenkt) er endret. */
  onProjectUpdated: () => void
}

/**
 * "Oversikt"-tab. Rekkefølge: Oppsett (PL/byggeleder/UE/timer) → fremdriftsplan
 * → interne kostnader → UE-kostnadsflyt per UE. Heroen (all toppøkonomi) ligger
 * over fanene i page.tsx. Summene (salgsverdi/UE-kost/fortjeneste) bor i heroen
 * — dupliseres ikke her.
 */
export default function OverviewSection({
  projectId,
  projectStart,
  projectEnd,
  plannedHoursOverride,
  orderValue,
  onOpenFremdriftsplan,
  onOpenInternalCosts,
  onOpenInvoices,
  invoices,
  milestones,
  budgetLines,
  internalCosts,
  totalInternalCost,
  allProducts,
  allSubs,
  projectSubs,
  weeklyReportsWL,
  productionEntries,
  onAddSub,
  onRequestRemoveSub,
  onProjectUpdated,
}: Props) {
  // Tab-local UI state (cost-flow accordion).
  const [expandedSub, setExpandedSub] = useState<string | null>(null)

  // ── Derived per-UE flow + intern-kort-grunnlag ────────────────────────
  const { subFlowData, internLines, internBudgetSales, internPct } = useMemo(() => {
    const assignedSubIds = new Set(projectSubs.map((ps) => ps.subcontractor_id))
    const projectSubDetails = allSubs.filter((s) => assignedSubIds.has(s.id))

    const approvedWRLines = weeklyReportsWL
      .filter((wr) => wr.status === 'approved' || wr.status === 'partially_approved')
      .flatMap((wr) => wr.lines.filter((l) => l.status === 'approved'))

    // UE-isolasjon i per-UE-nedbrytningen (samme regel som SubcontractorsSection):
    // «Uten kost» tilskrives KUN føringer denne UE-en faktisk utførte
    // (executed_by='subcontractor' && subcontractor_id===sub.id). En intern/other-
    // føring (egenprod) skal ALDRI dukke opp i en UEs nedbrytning — derfor nøkles
    // uten-kost-summen per (UE, budsjettlinje), ikke bare per budsjettlinje.
    const noCostBySubLine = new Map<string, number>()
    for (const e of productionEntries) {
      if (!e.project_budget_line_id) continue
      if (e.executed_by !== 'subcontractor' || !e.subcontractor_id) continue
      const key = `${e.subcontractor_id}::${e.project_budget_line_id}`
      noCostBySubLine.set(key, (noCostBySubLine.get(key) ?? 0) + e.quantity)
    }

    const subFlowData = projectSubDetails.map((sub) => {
      const subBudgetLines = budgetLines.filter((bl) => bl.assigned_subcontractor_id === sub.id)
      const budgetCost = subBudgetLines.reduce(
        (s, bl) => s + bl.budget_quantity * bl.subcontractor_cost_price_snapshot,
        0,
      )
      const subApprovedLines = approvedWRLines.filter((l) => {
        const bl = budgetLines.find((b) => b.id === l.project_budget_line_id)
        return bl?.assigned_subcontractor_id === sub.id
      })
      const reportedCost = subApprovedLines.reduce((s, l) => {
        const bl = budgetLines.find((b) => b.id === l.project_budget_line_id)
        return s + l.reported_quantity * (bl?.subcontractor_cost_price_snapshot ?? 0)
      }, 0)
      const products = subBudgetLines.map((bl) => {
        const product = allProducts.find((p) => p.id === bl.product_id)
        const reportedForLine = subApprovedLines
          .filter((l) => l.project_budget_line_id === bl.id)
          .reduce((s, l) => s + l.reported_quantity, 0)
        return {
          id: bl.id,
          name: fmtProductLabel(product),
          unit: product?.unit ?? '–',
          budgetQty: bl.budget_quantity,
          reportedQty: reportedForLine,
          noCostQty: noCostBySubLine.get(`${sub.id}::${bl.id}`) ?? 0,
          budgetCost: bl.budget_quantity * bl.subcontractor_cost_price_snapshot,
          reportedCost: reportedForLine * bl.subcontractor_cost_price_snapshot,
          pct: bl.budget_quantity > 0 ? Math.round((reportedForLine / bl.budget_quantity) * 100) : 0,
        }
      })
      return {
        id: sub.id,
        name: sub.company_name,
        contact: sub.contact_person,
        budgetCost,
        reportedCost,
        remaining: Math.max(0, budgetCost - reportedCost),
        pct: budgetCost > 0 ? Math.round((reportedCost / budgetCost) * 100) : 0,
        products,
      }
    })

    const internLines = budgetLines.filter((bl) => bl.assigned_subcontractor_id === '__intern__')
    const internBudgetSales = internLines.reduce(
      (s, bl) => s + bl.budget_quantity * bl.customer_price_snapshot,
      0,
    )
    const internPct = internBudgetSales > 0 ? Math.round((totalInternalCost / internBudgetSales) * 100) : 0

    return { subFlowData, internLines, internBudgetSales, internPct }
  }, [budgetLines, projectSubs, allSubs, weeklyReportsWL, allProducts, totalInternalCost, productionEntries])

  return (
    <div className="space-y-8">
      {/* Oppsett + Fakturering side om side som to halvbokser. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <ProjectSetupCard
          projectId={projectId}
          projectSubs={projectSubs}
          allSubs={allSubs}
          plannedHoursOverride={plannedHoursOverride}
          onAddSub={onAddSub}
          onRequestRemoveSub={onRequestRemoveSub}
          onProjectUpdated={onProjectUpdated}
        />
        <InvoicingSummaryCard
          projectId={projectId}
          orderValue={orderValue}
          invoices={invoices}
          onAdded={onProjectUpdated}
          onOpenInvoices={onOpenInvoices}
        />
      </div>

      {/* Fremdriftsplan (vises som før — uendret). */}
      <PhasesMiniStrip
        projectId={projectId}
        projectStart={projectStart}
        projectEnd={projectEnd}
        milestones={milestones}
        onOpenFremdriftsplan={onOpenFremdriftsplan}
      />

      {/* Interne kostnader — oppsummering + hurtig-innlegging. */}
      <InternalCostsSummaryCard
        projectId={projectId}
        internalCosts={internalCosts}
        totalInternalCost={totalInternalCost}
        onAdded={onProjectUpdated}
        onOpenFull={onOpenInternalCosts}
      />

      {/* UE-kostnadsflyt: per-UE budsjett vs. rapportert + produktdrilldown.
          Administrasjon (legg til / fjern) bor i Oppsett-kortet over. */}
      <section>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">Kostnadsflyt UE</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {internLines.length > 0 && (
            <div className="bg-white rounded-xl border border-indigo-200 shadow-sm overflow-hidden">
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-[var(--color-text-primary)] text-sm">Intern / MinUE</span>
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-medium">Intern</span>
                </div>
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-[var(--color-text-muted)] mb-1">
                    <span>Internkost brukt {internPct}%</span>
                    <span>{fmt(totalInternalCost)} / {fmt(internBudgetSales)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${internPct > 100 ? 'bg-red-500' : internPct > 80 ? 'bg-orange-400' : 'bg-indigo-500'}`} style={{ width: `${Math.min(internPct, 100)}%` }} />
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 text-xs mt-2">
                  <span className="text-[var(--color-text-muted)]">Salgsverdi intern: <span className="font-medium text-[var(--color-text-primary)]">{fmt(internBudgetSales)}</span></span>
                  <span className="text-[var(--color-text-muted)]">Registrert internkost: <span className="font-medium text-[var(--color-text-primary)]">{fmt(totalInternalCost)}</span></span>
                  <span className={`font-medium ${internBudgetSales - totalInternalCost >= 0 ? 'text-green-600' : 'text-red-600'}`}>Fortjeneste: {fmt(internBudgetSales - totalInternalCost)}</span>
                </div>
              </div>
            </div>
          )}
          {subFlowData.map((sf) => (
            <div key={sf.id} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
              <button onClick={() => setExpandedSub(expandedSub === sf.id ? null : sf.id)} className="w-full text-left p-4 hover:bg-muted transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-[var(--color-text-primary)] text-sm">{sf.name}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">{expandedSub === sf.id ? '▲' : '▼'}</span>
                </div>
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-[var(--color-text-muted)] mb-1">
                    <span>Rapportert {sf.pct}%</span>
                    <span>{fmt(sf.reportedCost)} / {fmt(sf.budgetCost)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${sf.pct > 90 ? 'bg-red-500' : sf.pct > 70 ? 'bg-orange-400' : 'bg-green-500'}`} style={{ width: `${Math.min(sf.pct, 100)}%` }} />
                  </div>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="text-[var(--color-text-muted)]">Gjenstår: <span className="font-medium text-[var(--color-text-primary)]">{fmt(sf.remaining)}</span></span>
                  <span className="text-[var(--color-text-muted)]">|</span>
                  <span className="text-[var(--color-text-muted)]">Budsjett: <span className="font-medium text-[var(--color-text-primary)]">{fmt(sf.budgetCost)}</span></span>
                </div>
              </button>
              {sf.contact && (
                <div className="border-t border-border px-4 py-2">
                  <span className="text-xs text-[var(--color-text-muted)] truncate">{sf.contact}</span>
                </div>
              )}
              {expandedSub === sf.id && (
                <div className="border-t border-border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted border-b border-border">
                        <th className="px-3 py-2 text-left font-medium text-[var(--color-text-muted)]">Produkt</th>
                        <th className="px-3 py-2 text-right font-medium text-[var(--color-text-muted)]">Budsjett</th>
                        <th className="px-3 py-2 text-right font-medium text-[var(--color-text-muted)]">Rapportert</th>
                        <th className="px-3 py-2 text-right font-medium text-[var(--color-text-muted)]">Uten kost</th>
                        <th className="px-3 py-2 text-right font-medium text-[var(--color-text-muted)]">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sf.products.map((prod) => (
                        <tr key={prod.id} className="border-b border-gray-50 last:border-0 hover:bg-muted">
                          <td className="px-3 py-2 text-[var(--color-text-primary)] max-w-[140px] truncate" title={prod.name}>{prod.name}<span className="text-[var(--color-text-muted)] ml-1">({prod.unit})</span></td>
                          <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">{prod.budgetQty}</td>
                          <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">{prod.reportedQty}</td>
                          <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">{prod.noCostQty || '–'}</td>
                          <td className={`px-3 py-2 text-right font-semibold ${prod.pct > 90 ? 'text-red-600' : prod.pct > 70 ? 'text-orange-500' : 'text-green-600'}`}>{prod.pct}%</td>
                        </tr>
                      ))}
                      <tr className="bg-muted border-t border-border">
                        <td className="px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">Totalt kostnad</td>
                        <td className="px-3 py-2 text-right font-semibold text-[var(--color-text-primary)]">{fmt(sf.budgetCost)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-[var(--color-text-primary)]">{fmt(sf.reportedCost)}</td>
                        <td className="px-3 py-2" />
                        <td className={`px-3 py-2 text-right font-bold ${sf.pct > 90 ? 'text-red-600' : sf.pct > 70 ? 'text-orange-500' : 'text-green-600'}`}>{sf.pct}%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
        {subFlowData.length === 0 && internLines.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">Ingen UE-er tildelt ennå — legg til i Oppsett over.</p>
        )}
      </section>
    </div>
  )
}
