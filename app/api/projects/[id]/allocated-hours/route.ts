import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, getProjectScope } from '@/lib/api-guard'
import {
  monthlyPool,
  allocatePoolByMonthlyRevenue,
  type MonthlyPool,
} from '@/lib/resource-allocation'
import { distributeForecastFromPhases, type PhaseSpanWeight } from '@/lib/forecast-distribution'
import type { InternalResource } from '@/types'

/**
 * GET /api/projects/[id]/allocated-hours
 *
 * Returnerer prosjektets tildelte interne timer fra ressurspoolen, fordelt per
 * måned vektet på prosjektets månedlige omsetning (se ØKONOMIMODELL.md pkt 3).
 *
 * Responsen er BAKOVERKOMPATIBEL: { hours, monthly }
 *   hours:   number | null — total over hele varigheten (brukes av ProjectSetupCard)
 *   monthly: Array<{ year, month, hours, cost }> — per-måned, sortert kronologisk
 *
 * null returneres (hours: null, monthly: []) når prosjektet ikke er aktivt
 * eller mangler fremdriftsplan-faser.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const scope = await getProjectScope(auth.user)
  if (scope && !scope.has(params.id)) {
    return NextResponse.json({ error: 'Prosjekt ikke funnet' }, { status: 404 })
  }

  const sb = getSupabaseAdmin()

  // Hent alle aktive prosjekter + nødvendig data for vekting
  const [projRes, blRes, coRes, phRes, resRes] = await Promise.all([
    sb
      .from('projects')
      .select('id, name, start_date, end_date')
      .eq('status', 'active')
      .neq('deleted', true),
    // Budget lines: trenger phase_id for avledet fasevekt (ØKONOMIMODELL.md 1b)
    sb
      .from('project_budget_lines')
      .select('id, project_id, budget_quantity, customer_price_snapshot, subcontractor_cost_price_snapshot, phase_id, source'),
    // Godkjente change orders: bidrar til budgetRevenue
    sb
      .from('change_orders')
      .select('project_id, total_customer_value')
      .eq('status', 'approved'),
    // Faser: trenger weight, start_date, end_date, project_id, id
    sb
      .from('project_phases')
      .select('id, project_id, start_date, end_date, weight'),
    sb.from('internal_resources').select('*'),
  ])

  type ProjectRow = { id: string; name: string; start_date: string | null; end_date: string | null }
  type BudgetLineRow = {
    id: string
    project_id: string
    budget_quantity: number
    customer_price_snapshot: number
    subcontractor_cost_price_snapshot: number
    phase_id?: string | null
    source?: string | null
  }
  type ChangeOrderRow = { project_id: string; total_customer_value: number }
  type PhaseRow = { id: string; project_id: string; start_date: string; end_date: string | null; weight: number | null }

  const projects = (projRes.data ?? []) as ProjectRow[]
  const budgetLines = (blRes.data ?? []) as BudgetLineRow[]
  const approvedCOs = (coRes.data ?? []) as ChangeOrderRow[]
  const phases = (phRes.data ?? []) as PhaseRow[]
  const resources = (resRes.data ?? []) as InternalResource[]

  const pool: MonthlyPool = monthlyPool(resources)

  // Grupper faser og budsjettlinjer per prosjekt
  const phasesByProject = new Map<string, PhaseRow[]>()
  for (const ph of phases) {
    const arr = phasesByProject.get(ph.project_id)
    if (arr) arr.push(ph); else phasesByProject.set(ph.project_id, [ph])
  }

  const linesByProject = new Map<string, BudgetLineRow[]>()
  for (const bl of budgetLines) {
    const arr = linesByProject.get(bl.project_id)
    if (arr) arr.push(bl); else linesByProject.set(bl.project_id, [bl])
  }

  const coByProject = new Map<string, ChangeOrderRow[]>()
  for (const co of approvedCOs) {
    const arr = coByProject.get(co.project_id)
    if (arr) arr.push(co); else coByProject.set(co.project_id, [co])
  }

  // Beregn månedlig omsetning per prosjekt via distributeForecastFromPhases
  // — nøyaktig samme avledning som generateFromPlan i forecast/page.tsx
  const monthlyRevenueByProject = new Map<string, Map<number, number>>()

  let globalStartMonth = Infinity
  let globalEndMonth = -Infinity

  for (const project of projects) {
    const projPhases = phasesByProject.get(project.id) ?? []
    if (projPhases.length === 0) continue

    const projLines = linesByProject.get(project.id) ?? []
    const projCOs = coByProject.get(project.id) ?? []

    // Avledet fasevekt: nøyaktig som generateFromPlan (forecast/page.tsx linje 361–369)
    const manualLines = projLines.filter((bl) => !bl.source || bl.source === 'manual')
    const salesByPhase = new Map<string, number>()
    for (const bl of manualLines) {
      if (!bl.phase_id) continue
      salesByPhase.set(
        bl.phase_id,
        (salesByPhase.get(bl.phase_id) ?? 0) + bl.budget_quantity * bl.customer_price_snapshot,
      )
    }
    const anyTagged = salesByPhase.size > 0

    const phasesForDist: PhaseSpanWeight[] = projPhases.map((p) => ({
      start_date: p.start_date,
      end_date: p.end_date,
      weight: p.weight,
      derivedWeight: anyTagged ? (salesByPhase.get(p.id) ?? 0) : null,
    }))

    // budgetRevenue = Σ manuelle linjer + Σ godkjente CO.total_customer_value
    const budgetRevenue =
      manualLines.reduce((s, bl) => s + bl.budget_quantity * bl.customer_price_snapshot, 0) +
      projCOs.reduce((s, co) => s + co.total_customer_value, 0)

    const dist = distributeForecastFromPhases({
      phases: phasesForDist,
      budgetRevenue,
      budgetCost: 0,
      internalCosts: [],
    })

    if (dist.size === 0) continue

    const revByMonth = new Map<number, number>()
    for (const mf of Array.from(dist.values())) {
      if (mf.revenue > 0) {
        revByMonth.set(mf.mi, (revByMonth.get(mf.mi) ?? 0) + mf.revenue)
      }
    }

    if (revByMonth.size === 0) continue

    monthlyRevenueByProject.set(project.id, revByMonth)

    // Oppdater global horisont
    for (const mi of Array.from(revByMonth.keys())) {
      if (mi < globalStartMonth) globalStartMonth = mi
      if (mi > globalEndMonth) globalEndMonth = mi
    }
  }

  // Finner ikke prosjektet (ikke aktivt / ingen faser med omsetning)
  if (!monthlyRevenueByProject.has(params.id) || globalStartMonth === Infinity) {
    return NextResponse.json({ hours: null, monthly: [] })
  }

  // Fordel pool over hele horisonten
  const allocation = allocatePoolByMonthlyRevenue(
    monthlyRevenueByProject,
    pool,
    globalStartMonth,
    globalEndMonth,
  )

  const targetAllocation = allocation.get(params.id) ?? new Map<number, { hours: number; cost: number }>()

  // Bygg måneds-array for target-prosjektet, sortert kronologisk
  const entries = Array.from(targetAllocation.entries()).sort(([a], [b]) => a - b)
  const monthly = entries.map(([mi, { hours, cost }]) => ({
    year: Math.floor(mi / 12),
    month: (mi % 12) + 1,   // 1–12
    hours: Math.round(hours * 100) / 100,
    cost: Math.round(cost * 100) / 100,
  }))

  const totalHours = monthly.reduce((s, r) => s + r.hours, 0)

  return NextResponse.json({
    hours: Math.round(totalHours),
    monthly,
  })
}
