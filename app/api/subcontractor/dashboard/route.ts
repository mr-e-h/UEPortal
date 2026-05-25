export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { isAdmin } from '@/lib/api-guard'
import type {
  Project,
  ProjectSubcontractor,
  ProjectBudgetLine,
  ChangeOrder,
  WeeklyReport,
  WeeklyReportLine,
  Product,
} from '@/types'

interface UEInvoice {
  id: string
  subcontractor_id: string
  amount: number
}

/**
 * Consolidated dashboard payload for one subcontractor. Replaces three
 * parallel fetches from the sub dashboard with one round trip and lets the
 * server do the joins/sums.
 *
 *   kpi.ordreverdi    — total cost value of all budget lines this UE was
 *                       assigned (their original "order book")
 *   kpi.fakturert     — sum of ue_invoices.amount the UE has filed
 *   kpi.fakturerbart  — approved work value (weekly-report lines + approved
 *                       change orders) minus what they've already invoiced.
 *                       i.e. what's ready to bill right now. Clamped ≥ 0
 *                       because invoices can occasionally outrun reports.
 *   kpi.gjenstaaende  — ordreverdi - fakturert: how much of the original
 *                       order book is still un-billed
 *
 *   pendingChangeOrders / pendingWeeklyReports — lists of submissions sat
 *   waiting for admin approval, ordered most-recent first.
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const subId = new URL(request.url).searchParams.get('subcontractor_id')
  if (!subId) return NextResponse.json({ error: 'subcontractor_id required' }, { status: 400 })
  if (!isAdmin(session) && session.subcontractor_id !== subId) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const sb = getSupabaseAdmin()
  const [
    projRes,
    psRes,
    blRes,
    coRes,
    wrRes,
    wrlRes,
    invRes,
    prodRes,
  ] = await Promise.all([
    sb.from('projects').select('id, name, project_number').neq('deleted', true),
    sb.from('project_subcontractors').select('project_id, subcontractor_id').eq('subcontractor_id', subId),
    sb.from('project_budget_lines').select('id, project_id, product_id, budget_quantity, subcontractor_cost_price_snapshot, assigned_subcontractor_id, line_type'),
    sb.from('change_orders').select('id, project_id, subcontractor_id, product_id, requested_quantity, unit, cost_price_snapshot, total_cost, status, submitted_at').eq('subcontractor_id', subId),
    sb.from('weekly_reports').select('id, project_id, subcontractor_id, year, week_number, status, submitted_at, submission_number').eq('subcontractor_id', subId),
    sb.from('weekly_report_lines').select('id, weekly_report_id, project_budget_line_id, reported_quantity, status'),
    sb.from('ue_invoices').select('id, subcontractor_id, amount').eq('subcontractor_id', subId),
    sb.from('products').select('id, name'),
  ])

  const projects = ((projRes.data ?? []) as Array<Pick<Project, 'id' | 'name' | 'project_number'>>)
  const links = ((psRes.data ?? []) as Pick<ProjectSubcontractor, 'project_id' | 'subcontractor_id'>[])
  const allBudgetLines = ((blRes.data ?? []) as ProjectBudgetLine[])
  const allChangeOrders = ((coRes.data ?? []) as ChangeOrder[])
  const myReports = ((wrRes.data ?? []) as WeeklyReport[])
  const allReportLines = ((wrlRes.data ?? []) as WeeklyReportLine[])
  const myInvoices = ((invRes.data ?? []) as UEInvoice[])
  const products = ((prodRes.data ?? []) as Pick<Product, 'id' | 'name'>[])

  const projectIds = new Set(links.map((l) => l.project_id))
  const projectMap = new Map(projects.map((p) => [p.id, p]))
  const productMap = new Map(products.map((p) => [p.id, p.name]))
  const blMap = new Map(allBudgetLines.map((bl) => [bl.id, bl]))

  // Lines this UE was assigned (cost view from their side, excluding non-sub line types)
  const myLines = allBudgetLines.filter(
    (bl) =>
      bl.assigned_subcontractor_id === subId &&
      projectIds.has(bl.project_id) &&
      (bl.line_type === 'subcontractor_work' || bl.line_type == null),
  )

  // KPI 1 — total ordreverdi (original order book)
  const ordreverdi = myLines.reduce(
    (s, bl) => s + bl.budget_quantity * bl.subcontractor_cost_price_snapshot,
    0,
  )

  // KPI 2 — fakturert
  const fakturert = myInvoices.reduce((s, i) => s + i.amount, 0)

  // Approved work value = approved weekly report lines + approved change orders
  const approvedReportIds = new Set(
    myReports
      .filter((r) => r.status === 'approved' || r.status === 'partially_approved')
      .map((r) => r.id),
  )
  const approvedLines = allReportLines.filter(
    (l) => approvedReportIds.has(l.weekly_report_id) && l.status === 'approved',
  )
  const approvedLineValue = approvedLines.reduce((s, l) => {
    const bl = blMap.get(l.project_budget_line_id)
    if (!bl) return s
    return s + l.reported_quantity * bl.subcontractor_cost_price_snapshot
  }, 0)
  const approvedCOValue = allChangeOrders
    .filter((co) => co.status === 'approved')
    .reduce((s, co) => s + co.total_cost, 0)
  const approvedWorkValue = approvedLineValue + approvedCOValue

  // KPI 3 — fakturerbart (clamped ≥ 0; invoices can occasionally outrun reports)
  const fakturerbart = Math.max(0, approvedWorkValue - fakturert)

  // KPI 4 — gjenstående å fakturere (original order book minus what's billed)
  const gjenstaaende = Math.max(0, ordreverdi - fakturert)

  // Pending change orders, newest first
  const pendingChangeOrders = allChangeOrders
    .filter((co) => co.status === 'pending')
    .sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))
    .map((co) => {
      const proj = projectMap.get(co.project_id)
      return {
        id: co.id,
        project_id: co.project_id,
        project_name: proj?.name ?? '–',
        project_number: proj?.project_number ?? '',
        product_name: productMap.get(co.product_id) ?? '–',
        quantity: co.requested_quantity,
        unit: co.unit,
        total_cost: co.total_cost,
        submitted_at: co.submitted_at ?? null,
      }
    })

  // Pending weekly reports (status = submitted). Compute per-report cost from
  // its lines so the row can show a value without an extra round-trip.
  const linesByReport = new Map<string, WeeklyReportLine[]>()
  for (const l of allReportLines) {
    const arr = linesByReport.get(l.weekly_report_id) ?? []
    arr.push(l)
    linesByReport.set(l.weekly_report_id, arr)
  }

  const pendingWeeklyReports = myReports
    .filter((r) => r.status === 'submitted')
    .sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))
    .map((r) => {
      const proj = projectMap.get(r.project_id)
      const lines = linesByReport.get(r.id) ?? []
      const totalCost = lines.reduce((s, l) => {
        const bl = blMap.get(l.project_budget_line_id)
        if (!bl) return s
        return s + l.reported_quantity * bl.subcontractor_cost_price_snapshot
      }, 0)
      return {
        id: r.id,
        project_id: r.project_id,
        project_name: proj?.name ?? '–',
        project_number: proj?.project_number ?? '',
        year: r.year,
        week_number: r.week_number,
        submission_number: r.submission_number ?? 1,
        line_count: lines.length,
        total_cost: totalCost,
        submitted_at: r.submitted_at ?? null,
      }
    })

  return NextResponse.json({
    kpi: { ordreverdi, fakturert, fakturerbart, gjenstaaende },
    pendingChangeOrders,
    pendingWeeklyReports,
  })
}
