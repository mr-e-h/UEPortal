'use client'

import { useMemo } from 'react'
import { fmtNOK as fmt, fmtProductLabel, fmtDateShort as fmtD } from '@/lib/format'
import { STATUS_LABEL, FALLBACK_COLOR } from '@/components/fremdriftsplan/core'
import type {
  ProjectBudgetLine,
  ProjectSubcontractor,
  Subcontractor,
  Product,
  WeeklyReport,
  WeeklyReportLine,
  ProjectPhase,
  PhaseType,
  ProductionEntry,
} from '@/types'

type WRWithLines = WeeklyReport & { lines: WeeklyReportLine[] }

interface Props {
  budgetLines: ProjectBudgetLine[]
  projectSubs: ProjectSubcontractor[]
  allSubs: Subcontractor[]
  allProducts: Product[]
  weeklyReportsWL: WRWithLines[]
  phases: ProjectPhase[]
  phaseTypes: PhaseType[]
  /** Produksjonsføringer (migrasjon 0018) — gir «utført uten kost»-mengde per linje. */
  productionEntries: ProductionEntry[]
}

const barTone = (pct: number) => (pct > 100 ? 'bg-red-500' : pct > 90 ? 'bg-orange-400' : 'bg-green-500')
const pctText = (pct: number) => (pct > 90 ? 'text-red-600' : pct > 70 ? 'text-orange-500' : 'text-green-600')

/**
 * «Underentreprenører»-fanen: per UE på prosjektet — det FULLE budsjettet
 * (kostlinjer + total UE-kost), økonomisk fremdrift (rapportert vs budsjett),
 * og fremdriften i PLANEN (fasene tildelt UE-en via subcontractor_id). All data
 * finnes fra før: budsjettlinjer, ukesrapporter og fremdriftsplan-faser.
 */
export default function SubcontractorsSection({
  budgetLines, projectSubs, allSubs, allProducts, weeklyReportsWL, phases, phaseTypes, productionEntries,
}: Props) {
  const typeById = useMemo(() => new Map(phaseTypes.map((t) => [t.id, t])), [phaseTypes])

  const flows = useMemo(() => {
    const assignedSubIds = new Set(projectSubs.map((ps) => ps.subcontractor_id))
    const subs = allSubs.filter((s) => assignedSubIds.has(s.id))
    const approvedLines = weeklyReportsWL
      .filter((wr) => wr.status === 'approved' || wr.status === 'partially_approved')
      .flatMap((wr) => wr.lines.filter((l) => l.status === 'approved'))

    // UE-isolasjon i per-UE-tabellen: «Uten kost» tilskrives KUN føringer denne
    // UE-en faktisk utførte (executed_by='subcontractor' && subcontractor_id===
    // sub.id). En intern/other-føring (egenprod) skal ALDRI dukke opp i en UEs
    // nedbrytning — derfor nøkles uten-kost-summen per (UE, budsjettlinje), ikke
    // bare per budsjettlinje.
    const noCostBySubLine = new Map<string, number>()
    for (const e of productionEntries) {
      if (!e.project_budget_line_id) continue
      if (e.executed_by !== 'subcontractor' || !e.subcontractor_id) continue
      const key = `${e.subcontractor_id}::${e.project_budget_line_id}`
      noCostBySubLine.set(key, (noCostBySubLine.get(key) ?? 0) + e.quantity)
    }

    return subs.map((sub) => {
      const lines = budgetLines.filter((bl) => bl.assigned_subcontractor_id === sub.id)
      const budgetCost = lines.reduce((s, bl) => s + bl.budget_quantity * bl.subcontractor_cost_price_snapshot, 0)
      const subApproved = approvedLines.filter((l) => {
        const bl = budgetLines.find((b) => b.id === l.project_budget_line_id)
        return bl?.assigned_subcontractor_id === sub.id
      })
      const reportedCost = subApproved.reduce((s, l) => {
        const bl = budgetLines.find((b) => b.id === l.project_budget_line_id)
        return s + l.reported_quantity * (bl?.subcontractor_cost_price_snapshot ?? 0)
      }, 0)
      const products = lines.map((bl) => {
        const product = allProducts.find((p) => p.id === bl.product_id)
        const reportedQty = subApproved
          .filter((l) => l.project_budget_line_id === bl.id)
          .reduce((s, l) => s + l.reported_quantity, 0)
        return {
          id: bl.id,
          name: fmtProductLabel(product),
          unit: product?.unit ?? '–',
          budgetQty: bl.budget_quantity,
          reportedQty,
          noCostQty: noCostBySubLine.get(`${sub.id}::${bl.id}`) ?? 0,
          budgetCost: bl.budget_quantity * bl.subcontractor_cost_price_snapshot,
          pct: bl.budget_quantity > 0 ? Math.round((reportedQty / bl.budget_quantity) * 100) : 0,
        }
      })
      const uePhases = phases
        .filter((p) => p.subcontractor_id === sub.id)
        .slice()
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
        .map((p) => {
          const t = typeById.get(p.phase_type_id)
          return {
            id: p.id,
            label: p.name || t?.name || 'Fase',
            color: t?.color || FALLBACK_COLOR,
            start: p.start_date,
            end: p.end_date,
            status: p.status,
            progress: p.progress_percent,
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
        phases: uePhases,
      }
    })
  }, [budgetLines, projectSubs, allSubs, allProducts, weeklyReportsWL, phases, typeById, productionEntries])

  const totalBudget = flows.reduce((s, f) => s + f.budgetCost, 0)
  const totalReported = flows.reduce((s, f) => s + f.reportedCost, 0)

  if (flows.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Underentreprenører</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Ingen underentreprenører er tildelt prosjektet ennå — legg dem til i Oppsett på Oversikt-fanen.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Underentreprenører</h2>
        <p className="text-xs text-[var(--color-text-muted)]">
          {flows.length} UE · budsjett <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">{fmt(totalBudget)}</span> · rapportert <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">{fmt(totalReported)}</span>
        </p>
      </div>

      <div className="space-y-4">
        {flows.map((ue) => (
          <div key={ue.id} className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Topp: navn + kontakt + nøkkeltall + fremdriftsbar */}
            <div className="p-4 border-b border-border">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{ue.name}</h3>
                  {ue.contact && <p className="text-xs text-[var(--color-text-muted)] truncate">{ue.contact}</p>}
                </div>
                <div className="flex items-center gap-6 text-right flex-none">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Budsjett</p>
                    <p className="text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">{fmt(ue.budgetCost)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Rapportert</p>
                    <p className="text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">{fmt(ue.reportedCost)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Gjenstår</p>
                    <p className="text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">{fmt(ue.remaining)}</p>
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <div className="flex justify-between text-[11px] text-[var(--color-text-muted)] mb-1">
                  <span>Rapportert mot budsjett</span><span className="tabular-nums">{ue.pct}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barTone(ue.pct)}`} style={{ width: `${Math.min(ue.pct, 100)}%` }} />
                </div>
              </div>
            </div>

            {/* Fremdrift i planen — fasene tildelt denne UE-en */}
            <div className="px-4 py-3 border-b border-border">
              <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Fremdrift (fremdriftsplan)</p>
              {ue.phases.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">Ingen faser tildelt denne UE-en ennå.</p>
              ) : (
                <div className="space-y-1.5">
                  {ue.phases.map((ph) => (
                    <div key={ph.id} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ backgroundColor: ph.color }} />
                      <span className="font-medium text-[var(--color-text-primary)] truncate flex-1 min-w-0">{ph.label}</span>
                      <span className="text-[var(--color-text-muted)] tabular-nums whitespace-nowrap">
                        {fmtD(ph.start)}{ph.end && ph.end !== ph.start ? ` – ${fmtD(ph.end)}` : ''}
                      </span>
                      <span className="w-28 text-right text-[var(--color-text-secondary)] whitespace-nowrap">
                        {STATUS_LABEL[ph.status]}{ph.progress > 0 ? ` · ${ph.progress}%` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Fullt budsjett — alle kostlinjer */}
            <div className="overflow-x-auto">
              {ue.products.length === 0 ? (
                <p className="px-4 py-3 text-xs text-[var(--color-text-muted)]">Ingen budsjettlinjer tildelt denne UE-en.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="px-4 py-2 text-left font-medium text-[var(--color-text-muted)]">Produkt</th>
                      <th className="px-3 py-2 text-right font-medium text-[var(--color-text-muted)]">Budsjett</th>
                      <th className="px-3 py-2 text-right font-medium text-[var(--color-text-muted)]">Rapportert</th>
                      <th className="px-3 py-2 text-right font-medium text-[var(--color-text-muted)]">Uten kost</th>
                      <th className="px-3 py-2 text-right font-medium text-[var(--color-text-muted)]">Budsjettkost</th>
                      <th className="px-3 py-2 text-right font-medium text-[var(--color-text-muted)]">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ue.products.map((pr) => (
                      <tr key={pr.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-2 text-[var(--color-text-primary)] max-w-[220px] truncate" title={pr.name}>
                          {pr.name} <span className="text-[var(--color-text-muted)]">({pr.unit})</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-secondary)]">{pr.budgetQty}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-secondary)]">{pr.reportedQty}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-secondary)]">{pr.noCostQty || '–'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-secondary)]">{fmt(pr.budgetCost)}</td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${pctText(pr.pct)}`}>{pr.pct}%</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/50 border-t border-border">
                      <td className="px-4 py-2 text-[10px] font-semibold uppercase text-[var(--color-text-secondary)]">Total UE-kost</td>
                      <td className="px-3 py-2" /><td className="px-3 py-2" /><td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-[var(--color-text-primary)]">{fmt(ue.budgetCost)}</td>
                      <td className={`px-3 py-2 text-right font-bold tabular-nums ${pctText(ue.pct)}`}>{ue.pct}%</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
