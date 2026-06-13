'use client'

import { FileDown } from 'lucide-react'
import PhasesMiniStrip from './PhasesMiniStrip'
import type { GanttMilestone, ProjectMonthPlan } from '@/types'
import { fmtNOK as fmt } from '@/lib/format'
import { printArea } from '@/lib/utils/print'

interface Props {
  projectId: string
  projectName: string
  projectStart: string
  projectEnd: string
  milestones: GanttMilestone[]
  monthPlans: ProjectMonthPlan[]
  onRefresh: () => Promise<void> | void
}

/**
 * Dedicated Fremdriftsplan tab — Gantt + a compact summary of the monthly
 * spending plan. The unified timeline lives in PhasesMiniStrip so it stays
 * a single source of truth and can be re-mounted on Oversikt as well.
 */
export default function FremdriftsplanSection({
  projectId, projectName, projectStart, projectEnd, milestones,
  monthPlans, onRefresh,
}: Props) {
  const totalPlannedRevenue = monthPlans.reduce((s, m) => s + (m.expected_revenue ?? 0), 0)
  const totalPlannedCost = monthPlans.reduce(
    (s, m) => s + (m.ue_cost ?? 0) + (m.internal_cost ?? 0) + (m.other_cost ?? 0),
    0,
  )


  return (
    <div className="space-y-8 print-area">
      {/* PDF-eksport av hele fanen (faser + tidslinje + månedsplan).
          Redigeringskontrollene skjules automatisk i utskriften. */}
      <div className="flex items-center justify-end -mb-4 print:hidden">
        <button
          type="button"
          onClick={printArea}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card text-[var(--color-text-secondary)] hover:bg-muted"
        >
          <FileDown size={13} /> Eksporter PDF
        </button>
      </div>

      {/* Header kun i PDF-en */}
      <div className="hidden print:block">
        <h1 className="text-lg font-bold text-black">Fremdriftsplan — {projectName}</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">Skrevet ut {new Date().toLocaleDateString('nb-NO')}</p>
      </div>

      {/* ÉN fremdriftsplan: tidslinjen ER editoren (faser + milepæler) —
          dra i endene, blyant for detaljer, legg til/slett i headeren.
          Den gamle Arbeidsfaser-tabellen og Gantt-editoren er slått sammen
          inn hit. */}
      <PhasesMiniStrip
        projectId={projectId}
        projectStart={projectStart}
        projectEnd={projectEnd}
        milestones={milestones}
        onMilestonesChanged={onRefresh}
        manage
      />

      {monthPlans.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3">Månedlig plan</h2>
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted border-b border-border">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase">Måned</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase">Forventet omsetning</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase">UE-kost</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase">Internkost</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase">Annet</th>
                </tr>
              </thead>
              <tbody>
                {monthPlans
                  .slice()
                  .sort((a, b) => `${a.year}-${a.month}`.localeCompare(`${b.year}-${b.month}`))
                  .map((m) => (
                    <tr key={`${m.year}-${m.month}`} className="border-b border-border last:border-0 hover:bg-muted">
                      <td className="px-4 py-2 text-[var(--color-text-primary)] font-medium">
                        {new Date(m.year, m.month - 1, 1).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-2 text-right text-[var(--color-text-secondary)]">{fmt(m.expected_revenue ?? 0)}</td>
                      <td className="px-4 py-2 text-right text-[var(--color-text-secondary)]">{fmt(m.ue_cost ?? 0)}</td>
                      <td className="px-4 py-2 text-right text-[var(--color-text-secondary)]">{fmt(m.internal_cost ?? 0)}</td>
                      <td className="px-4 py-2 text-right text-[var(--color-text-secondary)]">{fmt(m.other_cost ?? 0)}</td>
                    </tr>
                  ))}
                <tr className="bg-muted border-t border-border">
                  <td className="px-4 py-2 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">Totalt</td>
                  <td className="px-4 py-2 text-right font-bold text-[var(--color-text-primary)]">{fmt(totalPlannedRevenue)}</td>
                  <td className="px-4 py-2 text-right font-bold text-[var(--color-text-primary)]" colSpan={3}>{fmt(totalPlannedCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
