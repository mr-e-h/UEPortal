'use client'

import GanttSection from './GanttSection'
import PhasesSection from './PhasesSection'
import type { GanttMilestone, Subcontractor, ProjectMonthPlan } from '@/types'
import { fmtNOK as fmt } from '@/lib/format'

interface Props {
  projectId: string
  projectStart: string
  projectEnd: string
  milestones: GanttMilestone[]
  allSubs: Subcontractor[]
  projectSubIds: string[]
  monthPlans: ProjectMonthPlan[]
  onRefresh: () => Promise<void> | void
}

/**
 * Dedicated Fremdriftsplan tab — Gantt + a compact summary of the monthly
 * spending plan. The Gantt itself still lives in GanttSection so it stays
 * a single source of truth and can be re-mounted on Oversikt as well.
 */
export default function FremdriftsplanSection({
  projectId, projectStart, projectEnd, milestones, allSubs, projectSubIds,
  monthPlans, onRefresh,
}: Props) {
  const totalPlannedRevenue = monthPlans.reduce((s, m) => s + (m.expected_revenue ?? 0), 0)
  const totalPlannedCost = monthPlans.reduce(
    (s, m) => s + (m.ue_cost ?? 0) + (m.internal_cost ?? 0) + (m.other_cost ?? 0),
    0,
  )

  return (
    <div className="space-y-8">
      <PhasesSection projectId={projectId} />

      <GanttSection
        projectId={projectId}
        projectStart={projectStart}
        projectEnd={projectEnd}
        milestones={milestones}
        allSubs={allSubs}
        projectSubs={projectSubIds}
        onRefresh={onRefresh}
      />

      {monthPlans.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Månedlig plan</h2>
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Måned</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Forventet omsetning</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">UE-kost</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Internkost</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Annet</th>
                </tr>
              </thead>
              <tbody>
                {monthPlans
                  .slice()
                  .sort((a, b) => `${a.year}-${a.month}`.localeCompare(`${b.year}-${b.month}`))
                  .map((m) => (
                    <tr key={`${m.year}-${m.month}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-900 font-medium">
                        {new Date(m.year, m.month - 1, 1).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-700">{fmt(m.expected_revenue ?? 0)}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{fmt(m.ue_cost ?? 0)}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{fmt(m.internal_cost ?? 0)}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{fmt(m.other_cost ?? 0)}</td>
                    </tr>
                  ))}
                <tr className="bg-gray-50 border-t border-gray-200">
                  <td className="px-4 py-2 text-xs font-semibold text-gray-700 uppercase">Totalt</td>
                  <td className="px-4 py-2 text-right font-bold text-gray-900">{fmt(totalPlannedRevenue)}</td>
                  <td className="px-4 py-2 text-right font-bold text-gray-900" colSpan={3}>{fmt(totalPlannedCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
