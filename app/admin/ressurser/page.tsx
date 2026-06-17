import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { USER_ADMIN_ROLES } from '@/lib/api-guard'
import { budgetSalesValue, emCustomerValue } from '@/lib/project-economy'
import {
  monthlyPool, buildMonthGrid, monthIndexFromISO, monthIndexNow, computeSpanISO,
  type ProjectSpan,
} from '@/lib/resource-allocation'
import type { Project, ProjectBudgetLine, ChangeOrder, InternalResource, InternalHoursMonthly } from '@/types'
import ResourcesClient from './ResourcesClient'

export const dynamic = 'force-dynamic'

type DateRow = { project_id: string; start_date: string | null; end_date: string | null }

/** Group rows by project_id. */
function groupByProject<T extends { project_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const arr = m.get(r.project_id) ?? []
    arr.push(r)
    m.set(r.project_id, arr)
  }
  return m
}

/**
 * Ressursoversikt — den interne ressurspoolen (timer per måned + timeskost) og
 * et måneds-rutenett som fordeler poolen utover prosjektene som er aktive hver
 * måned (aktiv span hentet fra fremdriftsplanen), vektet på omsetning (total
 * kontraktsverdi).
 *
 * Porteføljevid kundeøkonomi → kun main/company (USER_ADMIN_ROLES).
 */
export default async function RessurserPage() {
  const me = await getSession()
  if (!me || !USER_ADMIN_ROLES.includes(me.role)) redirect('/login')

  const now = new Date()
  const currentYear = now.getFullYear()

  const sb = getSupabaseAdmin()
  const [projRes, blRes, coRes, resRes, phRes, msRes, ihmRes] = await Promise.all([
    sb.from('projects').select('id, name, project_number, status, start_date, end_date, planned_hours').eq('status', 'active').neq('deleted', true),
    sb.from('project_budget_lines').select('project_id, budget_quantity, customer_price_snapshot, subcontractor_cost_price_snapshot'),
    sb.from('change_orders').select('project_id, status, total_customer_value, total_cost').eq('status', 'approved'),
    sb.from('internal_resources').select('*').order('created_at', { ascending: true }),
    sb.from('project_phases').select('project_id, start_date, end_date'),
    sb.from('milestones').select('project_id, start_date, end_date'),
    sb.from('internal_hours_monthly').select('*').eq('year', currentYear),
  ])

  const projects = (projRes.data ?? []) as Array<Pick<Project, 'id' | 'name' | 'start_date' | 'end_date' | 'planned_hours'>>
  const budgetLines = (blRes.data ?? []) as ProjectBudgetLine[]
  const approvedEMs = (coRes.data ?? []) as ChangeOrder[]
  const resources = (resRes.data ?? []) as InternalResource[]
  const phasesByProject = groupByProject((phRes.data ?? []) as DateRow[])
  const milestonesByProject = groupByProject((msRes.data ?? []) as DateRow[])
  const monthlyActuals = (ihmRes.data ?? []) as InternalHoursMonthly[]

  const currentMonth = monthIndexNow(now)

  // Build each active project's span + revenue; drop projects that have already
  // finished (their span ends before this month).
  const spans: ProjectSpan[] = []
  for (const p of projects) {
    const span = computeSpanISO(p, phasesByProject.get(p.id) ?? [], milestonesByProject.get(p.id) ?? [])
    if (!span) continue
    const startMonth = monthIndexFromISO(span.start)
    const endMonth = monthIndexFromISO(span.end)
    if (endMonth < currentMonth) continue
    const lines = budgetLines.filter((bl) => bl.project_id === p.id)
    const ems = approvedEMs.filter((co) => co.project_id === p.id)
    spans.push({ id: p.id, name: p.name, revenue: budgetSalesValue(lines) + emCustomerValue(ems), startMonth, endMonth })
  }
  spans.sort((a, b) => a.startMonth - b.startMonth || b.revenue - a.revenue)

  const pool = monthlyPool(resources)
  // Horizon: this month → latest project end, capped at 24 months so an outlier
  // end date can't blow the grid up.
  const endHorizon = spans.length > 0
    ? Math.min(Math.max(currentMonth, ...spans.map((s) => s.endMonth)), currentMonth + 23)
    : currentMonth
  // Manuelle timer-overstyringer (planned_hours): låses + trekkes fra poolen,
  // residual til de ikke-overstyrte prosjektene.
  const overrides = new Map<string, number>()
  for (const p of projects) if (p.planned_hours != null) overrides.set(p.id, p.planned_hours)
  const grid = buildMonthGrid(spans, pool, currentMonth, endHorizon, overrides)

  return (
    <ResourcesClient
      resources={resources}
      grid={grid}
      monthlyActuals={monthlyActuals}
      currentYear={currentYear}
      currentMonthNum={now.getMonth() + 1}
    />
  )
}
