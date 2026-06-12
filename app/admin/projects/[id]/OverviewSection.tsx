'use client'

import { useMemo, useState } from 'react'
import { fmtNOK as fmt, fmtProductLabel } from '@/lib/format'
import ProjectManagersCard from './ProjectManagersCard'
import SiteManagersCard from './SiteManagersCard'
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
} from '@/types'

type WRWithLines = WeeklyReport & { lines: WeeklyReportLine[] }

interface Props {
  projectId: string
  projectStart: string | null
  projectEnd: string | null
  onOpenFremdriftsplan: () => void
  /** Fra useProjectData — samme objekt Gantt-en på Fremdriftsplan-fanen får. */
  milestones: GanttMilestone[]
  budgetLines: ProjectBudgetLine[]
  internalCosts: ProjectInternalCostEntry[]
  allProducts: Product[]
  allSubs: Subcontractor[]
  projectSubs: ProjectSubcontractor[]
  weeklyReportsWL: WRWithLines[]
  // Add-UE row state lives in the parent because the form spans tab boundaries
  // visually (it's a section, not the whole tab).
  addSubId: string
  setAddSubId: (v: string) => void
  onAddSub: () => Promise<void> | void
  onRequestRemoveSub: (linkId: string) => void
}

/**
 * "Oversikt"-tab: project KPIs, budget version history, Excel import,
 * Gantt, cost-flow per UE, and the project-UE management list.
 *
 * Derived totals (totalSales, subFlowData, internPct...) are computed
 * inline here via useMemo — they're only needed when this tab is active,
 * so there's no reason to push them into useProjectData(). Forecast and
 * internal-cost totals that other tabs ALSO need stay computed in the
 * parent (cheap recompute).
 */
export default function OverviewSection({
  projectId,
  projectStart,
  projectEnd,
  onOpenFremdriftsplan,
  milestones,
  budgetLines,
  internalCosts,
  allProducts,
  allSubs,
  projectSubs,
  weeklyReportsWL,
  addSubId,
  setAddSubId,
  onAddSub,
  onRequestRemoveSub,
}: Props) {
  // Tab-local UI state (cost-flow accordion).
  const [expandedSub, setExpandedSub] = useState<string | null>(null)

  // ── Derived totals ────────────────────────────────────────────────
  const {
    totalInternalCost,
    subFlowData,
    internLines,
    internBudgetSales,
    internPct,
    availableSubs,
  } = useMemo(() => {
    // Summene (salgsverdi/UE-kost/fortjeneste) regnes i ProjectStatusHero —
    // her trengs kun internkost (intern-kortet) + per-UE-flyt.
    const totalInternalCost = internalCosts.reduce((s, c) => s + c.amount, 0)

    const assignedSubIds = new Set(projectSubs.map((ps) => ps.subcontractor_id))
    const projectSubDetails = allSubs.filter((s) => assignedSubIds.has(s.id))
    const availableSubs = allSubs.filter((s) => s.active && !assignedSubIds.has(s.id))

    // UE flow data: budget vs reported per UE, drillable to product level.
    const approvedWRLines = weeklyReportsWL
      .filter((wr) => wr.status === 'approved' || wr.status === 'partially_approved')
      .flatMap((wr) => wr.lines.filter((l) => l.status === 'approved'))

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
          budgetCost: bl.budget_quantity * bl.subcontractor_cost_price_snapshot,
          reportedCost: reportedForLine * bl.subcontractor_cost_price_snapshot,
          pct: bl.budget_quantity > 0 ? Math.round((reportedForLine / bl.budget_quantity) * 100) : 0,
        }
      })
      return {
        id: sub.id,
        name: sub.company_name,
        contact: sub.contact_person,
        linkId: projectSubs.find((ps) => ps.subcontractor_id === sub.id)?.id ?? null,
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
    const internPct = internBudgetSales > 0
      ? Math.round((totalInternalCost / internBudgetSales) * 100)
      : 0

    return {
      totalInternalCost,
      subFlowData, internLines, internBudgetSales, internPct,
      availableSubs,
    }
  }, [budgetLines, internalCosts, projectSubs, allSubs, weeklyReportsWL, allProducts])

  return (
    <div className="space-y-8">
      {/* Prosjektstatistikk → Kost-fanen. Budsjettversjonhistorikk +
          Excel-import → Budsjett-fanen. Redigerbar plan → Fremdriftsplan-
          fanen. Oversikt = hero (all økonomi) + røff fase-stripe + UE + team. */}

      <PhasesMiniStrip
        projectId={projectId}
        projectStart={projectStart}
        projectEnd={projectEnd}
        milestones={milestones}
        onOpenFremdriftsplan={onOpenFremdriftsplan}
      />

      {/* UE-seksjonen: per-UE-kortene bærer både fremdrift (rapportert/
          budsjett/gjenstår + produktdrilldown) og administrasjon (kontakt +
          fjern); legg-til bor i seksjonsheaderen. Summene (salgsverdi/UE-kost/
          fortjeneste) bor i status-heroen — IKKE dupliser dem her. */}
      <section>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Underentreprenører</h2>
            <div className="flex gap-2 items-center">
              <select
                value={addSubId}
                onChange={(e) => setAddSubId(e.target.value)}
                className="text-sm text-gray-900 border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-blue-500"
              >
                <option value="">+ Legg til UE</option>
                {availableSubs.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
              </select>
              <button
                onClick={() => onAddSub()}
                disabled={!addSubId}
                className="px-2.5 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-40"
              >
                Legg til
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {internLines.length > 0 && (
              <div className="bg-white rounded-xl border border-indigo-200 shadow-sm overflow-hidden">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-gray-900 text-sm">Intern / MinUE</span>
                    <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-medium">Intern</span>
                  </div>
                  <div className="mb-2">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Internkost brukt {internPct}%</span>
                      <span>{fmt(totalInternalCost)} / {fmt(internBudgetSales)}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${internPct > 100 ? 'bg-red-500' : internPct > 80 ? 'bg-orange-400' : 'bg-indigo-500'}`} style={{ width: `${Math.min(internPct, 100)}%` }} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5 text-xs mt-2">
                    <span className="text-gray-500">Salgsverdi intern: <span className="font-medium text-gray-900">{fmt(internBudgetSales)}</span></span>
                    <span className="text-gray-500">Registrert internkost: <span className="font-medium text-gray-900">{fmt(totalInternalCost)}</span></span>
                    <span className={`font-medium ${internBudgetSales - totalInternalCost >= 0 ? 'text-green-600' : 'text-red-600'}`}>Fortjeneste: {fmt(internBudgetSales - totalInternalCost)}</span>
                  </div>
                </div>
              </div>
            )}
            {subFlowData.map((sf) => (
              <div key={sf.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <button onClick={() => setExpandedSub(expandedSub === sf.id ? null : sf.id)} className="w-full text-left p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-gray-900 text-sm">{sf.name}</span>
                    <span className="text-xs text-gray-400">{expandedSub === sf.id ? '▲' : '▼'}</span>
                  </div>
                  <div className="mb-2">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Rapportert {sf.pct}%</span>
                      <span>{fmt(sf.reportedCost)} / {fmt(sf.budgetCost)}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${sf.pct > 90 ? 'bg-red-500' : sf.pct > 70 ? 'bg-orange-400' : 'bg-green-500'}`} style={{ width: `${Math.min(sf.pct, 100)}%` }} />
                    </div>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <span className="text-gray-500">Gjenstår: <span className="font-medium text-gray-900">{fmt(sf.remaining)}</span></span>
                    <span className="text-gray-400">|</span>
                    <span className="text-gray-500">Budsjett: <span className="font-medium text-gray-900">{fmt(sf.budgetCost)}</span></span>
                  </div>
                </button>
                {/* Kontakt + fjern utenfor expand-knappen (gyldig HTML, og
                    ingen utilsiktede klikk på destruktiv handling). */}
                <div className="border-t border-gray-100 px-4 py-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500 truncate">{sf.contact || ''}</span>
                  {sf.linkId && (
                    <button
                      onClick={() => onRequestRemoveSub(sf.linkId!)}
                      className="text-xs text-red-500 hover:text-red-700 flex-none"
                    >
                      Fjern
                    </button>
                  )}
                </div>
                {expandedSub === sf.id && (
                  <div className="border-t border-gray-100 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-3 py-2 text-left font-medium text-gray-500">Produkt</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-500">Budsjett</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-500">Rapportert</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-500">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sf.products.map((prod) => (
                          <tr key={prod.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-900 max-w-[140px] truncate" title={prod.name}>{prod.name}<span className="text-gray-400 ml-1">({prod.unit})</span></td>
                            <td className="px-3 py-2 text-right text-gray-700">{prod.budgetQty}</td>
                            <td className="px-3 py-2 text-right text-gray-700">{prod.reportedQty}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${prod.pct > 90 ? 'text-red-600' : prod.pct > 70 ? 'text-orange-500' : 'text-green-600'}`}>{prod.pct}%</td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 border-t border-gray-200">
                          <td className="px-3 py-2 text-xs font-semibold text-gray-600 uppercase">Totalt kostnad</td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-900">{fmt(sf.budgetCost)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-900">{fmt(sf.reportedCost)}</td>
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
            <p className="text-sm text-gray-400">Ingen UE-er tildelt ennå — bruk «Legg til UE» over.</p>
          )}
        </section>

      {/* Team: PL + byggeledere side ved side. Kortene har egne titler —
          ingen ekstra caps-etiketter over. UE-administrasjonen bor i
          Kostnadsflyt-seksjonen (ett sted per aktør, ikke to). */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <ProjectManagersCard projectId={projectId} />
        <SiteManagersCard projectId={projectId} />
      </section>
    </div>
  )
}
