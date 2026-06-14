import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, getProjectScope } from '@/lib/api-guard'
import { budgetSalesValue, emCustomerValue } from '@/lib/project-economy'
import {
  monthlyPool, buildMonthGrid, monthIndexFromISO, computeSpanISO, type ProjectSpan,
} from '@/lib/resource-allocation'
import type { Project, ProjectBudgetLine, ChangeOrder, InternalResource } from '@/types'

type DateRow = { project_id: string; start_date: string | null; end_date: string | null }

function groupByProject(rows: DateRow[]): Map<string, DateRow[]> {
  const m = new Map<string, DateRow[]>()
  for (const r of rows) {
    const arr = m.get(r.project_id)
    if (arr) arr.push(r); else m.set(r.project_id, [r])
  }
  return m
}

/**
 * GET /api/projects/[id]/allocated-hours
 *
 * Prosjektets TILTENKTE interne timer — ikke et manuelt tall, men beregnet:
 * den interne timepoolen fordeles hver måned på de aktive prosjektene vektet på
 * omsetning (ordreverdi), nøyaktig som Ressurser-siden. Summen av prosjektets
 * andel over hele varigheten (start→slutt fra fremdriftsplanen) er tallet.
 *
 * Returnerer { hours: number | null }. null når prosjektet ikke er aktivt eller
 * mangler datoer (da er det ikke noe å fordele på).
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const scope = await getProjectScope(auth.user)
  if (scope && !scope.has(params.id)) {
    return NextResponse.json({ error: 'Prosjekt ikke funnet' }, { status: 404 })
  }

  const sb = getSupabaseAdmin()
  const [projRes, blRes, coRes, resRes, phRes, msRes] = await Promise.all([
    sb.from('projects').select('id, name, start_date, end_date').eq('status', 'active').neq('deleted', true),
    sb.from('project_budget_lines').select('project_id, budget_quantity, customer_price_snapshot, subcontractor_cost_price_snapshot'),
    sb.from('change_orders').select('project_id, status, total_customer_value, total_cost').eq('status', 'approved'),
    sb.from('internal_resources').select('*'),
    sb.from('project_phases').select('project_id, start_date, end_date'),
    sb.from('milestones').select('project_id, start_date, end_date'),
  ])

  const projects = (projRes.data ?? []) as Array<Pick<Project, 'id' | 'name' | 'start_date' | 'end_date'>>
  const budgetLines = (blRes.data ?? []) as ProjectBudgetLine[]
  const approvedEMs = (coRes.data ?? []) as ChangeOrder[]
  const resources = (resRes.data ?? []) as InternalResource[]
  const phasesByProject = groupByProject((phRes.data ?? []) as DateRow[])
  const milestonesByProject = groupByProject((msRes.data ?? []) as DateRow[])

  // Bygg span + omsetning for alle aktive prosjekter (grunnlag for vektingen).
  const spans: ProjectSpan[] = []
  for (const p of projects) {
    const span = computeSpanISO(p, phasesByProject.get(p.id) ?? [], milestonesByProject.get(p.id) ?? [])
    if (!span) continue
    const lines = budgetLines.filter((bl) => bl.project_id === p.id)
    const ems = approvedEMs.filter((co) => co.project_id === p.id)
    spans.push({
      id: p.id,
      name: p.name,
      revenue: budgetSalesValue(lines) + emCustomerValue(ems),
      startMonth: monthIndexFromISO(span.start),
      endMonth: monthIndexFromISO(span.end),
    })
  }

  const self = spans.find((s) => s.id === params.id)
  if (!self) return NextResponse.json({ hours: null })

  // Fordel poolen over prosjektets egen varighet; summer prosjektets andel.
  const grid = buildMonthGrid(spans, monthlyPool(resources), self.startMonth, self.endMonth)
  const row = grid.rows.find((r) => r.id === params.id)
  return NextResponse.json({ hours: Math.round(row?.totalHours ?? 0) })
}
