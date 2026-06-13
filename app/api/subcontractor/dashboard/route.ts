export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { resolveEffectiveSub } from '@/lib/tender'
import { fmtChangeOrderTitle } from '@/lib/format'
import type {
  Project,
  ProjectSubcontractor,
  ProjectBudgetLine,
  ChangeOrder,
  WeeklyReport,
  WeeklyReportLine,
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
export async function GET(_request: NextRequest) {
  // UE-portal: subcontractor comes from the (effective) session, never the URL.
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  const subId = eff.subId

  const sb = getSupabaseAdmin()
  const [
    projRes,
    psRes,
    blRes,
    coRes,
    wrRes,
    wrlRes,
    invRes,
    pmRes,
    usersRes,
  ] = await Promise.all([
    sb.from('projects').select('id, name, project_number, end_date').neq('deleted', true),
    sb.from('project_subcontractors').select('project_id, subcontractor_id').eq('subcontractor_id', subId),
    sb.from('project_budget_lines').select('id, project_id, product_id, budget_quantity, subcontractor_cost_price_snapshot, assigned_subcontractor_id, line_type'),
    // change_order_number MÅ være med — dashboardet bygger "Endringsmelding N"-
    // titler fra den; uten feltet rendres "Endringsmelding ?".
    sb.from('change_orders').select('id, change_order_number, project_id, subcontractor_id, product_id, requested_quantity, unit, cost_price_snapshot, total_cost, status, submitted_at').eq('subcontractor_id', subId),
    sb.from('weekly_reports').select('id, project_id, subcontractor_id, year, week_number, status, submitted_at, submission_number').eq('subcontractor_id', subId),
    sb.from('weekly_report_lines').select('id, weekly_report_id, project_budget_line_id, reported_quantity, status'),
    sb.from('ue_invoices').select('id, subcontractor_id, amount').eq('subcontractor_id', subId),
    sb.from('project_managers').select('project_id, user_id'),
    sb.from('users').select('id, full_name, email, active').eq('active', true),
  ])

  const projects = ((projRes.data ?? []) as Array<Pick<Project, 'id' | 'name' | 'project_number' | 'end_date'>>)
  const links = ((psRes.data ?? []) as Pick<ProjectSubcontractor, 'project_id' | 'subcontractor_id'>[])
  const allBudgetLines = ((blRes.data ?? []) as ProjectBudgetLine[])
  const allChangeOrders = ((coRes.data ?? []) as ChangeOrder[])
  const myReports = ((wrRes.data ?? []) as WeeklyReport[])
  const allReportLines = ((wrlRes.data ?? []) as WeeklyReportLine[])
  const myInvoices = ((invRes.data ?? []) as UEInvoice[])
  const pmLinks = ((pmRes.data ?? []) as Array<{ project_id: string; user_id: string }>)
  const users = ((usersRes.data ?? []) as Array<{ id: string; full_name: string; email: string }>)

  const projectIds = new Set(links.map((l) => l.project_id))
  const projectMap = new Map(projects.map((p) => [p.id, p]))
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

  // Bulk-sjekk hvilke av UEs EM-er har 'edited'-rader fra admin og hvilke
  // har konsekvens-linjer. Brukes til badges på dashboardet uten N+1.
  const allMyEmIds = allChangeOrders.map((co) => co.id)
  let dashEditedSet = new Set<string>()
  let dashConseqSet = new Set<string>()
  if (allMyEmIds.length > 0) {
    const [editedRes, conseqRes] = await Promise.all([
      sb.from('activity_log').select('entity_id')
        .eq('entity_type', 'change_order').eq('action', 'edited')
        .in('entity_id', allMyEmIds),
      sb.from('change_order_consequence_lines').select('change_order_id')
        .in('change_order_id', allMyEmIds),
    ])
    dashEditedSet = new Set((editedRes.data ?? []).map((r: { entity_id: string }) => r.entity_id))
    dashConseqSet = new Set((conseqRes.data ?? []).map((r: { change_order_id: string }) => r.change_order_id))
  }

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
        em_title: fmtChangeOrderTitle(co.change_order_number, proj?.name),
        change_order_number: co.change_order_number,
        em_type: co.em_type,
        total_cost: co.total_cost,
        submitted_at: co.submitted_at ?? null,
        submitted_by: co.submitted_by ?? null,
        status: co.status,
        has_admin_edits: dashEditedSet.has(co.id),
        has_consequence_lines: dashConseqSet.has(co.id),
      }
    })

  // EM-er admin har sendt tilbake til revisjon. Dette er UEs oppgaver — de
  // må rette opp og sende inn på nytt. Vises i en egen oransje seksjon på
  // dashboardet med admin-kommentaren synlig.
  const revisionChangeOrders = allChangeOrders
    .filter((co) => co.status === 'revision_requested')
    .sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))
    .map((co) => {
      const proj = projectMap.get(co.project_id)
      return {
        id: co.id,
        project_id: co.project_id,
        project_name: proj?.name ?? '–',
        project_number: proj?.project_number ?? '',
        em_title: fmtChangeOrderTitle(co.change_order_number, proj?.name),
        change_order_number: co.change_order_number,
        em_type: co.em_type,
        total_cost: co.total_cost,
        admin_comment: co.admin_comment ?? '',
        submitted_at: co.submitted_at ?? null,
        submitted_by: co.submitted_by ?? null,
        status: co.status,
        has_admin_edits: dashEditedSet.has(co.id),
        has_consequence_lines: dashConseqSet.has(co.id),
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

  // Per-project pending counts — power the "antall ubehandlede" badges in
  // the Mine prosjekter table on the dashboard.
  const pendingCOByProject = new Map<string, number>()
  for (const co of allChangeOrders) {
    if (co.status !== 'pending') continue
    pendingCOByProject.set(co.project_id, (pendingCOByProject.get(co.project_id) ?? 0) + 1)
  }
  const pendingWRByProject = new Map<string, number>()
  for (const r of myReports) {
    if (r.status !== 'submitted') continue
    pendingWRByProject.set(r.project_id, (pendingWRByProject.get(r.project_id) ?? 0) + 1)
  }

  // Value of submitted-but-not-yet-approved weekly reports. From the sub's
  // cash-flow view this is "I've done the work, I'm waiting for admin to
  // approve so I can invoice".
  const produsertIkkeBedt = pendingWeeklyReports.reduce((s, r) => s + r.total_cost, 0)

  // Per-project breakdown for the rich "Mine prosjekter"-list. Includes
  //  - ordreverdi (cost-side budget, since that's the UE's perspective)
  //  - approved value (what they've delivered so far)
  //  - progressPct = approved / ordreverdi  (cost-based progress)
  //  - end_date (deadline)
  //  - project_managers (contact persons)
  const pmsByProject = new Map<string, Array<{ id: string; full_name: string; email: string }>>()
  const userMap = new Map(users.map((u) => [u.id, u]))
  for (const link of pmLinks) {
    if (!projectIds.has(link.project_id)) continue
    const user = userMap.get(link.user_id)
    if (!user) continue
    const arr = pmsByProject.get(link.project_id) ?? []
    arr.push({ id: user.id, full_name: user.full_name, email: user.email })
    pmsByProject.set(link.project_id, arr)
  }

  // Pre-bucket approved line value per project so we don't loop twice.
  const approvedValueByProject = new Map<string, number>()
  for (const l of approvedLines) {
    const bl = blMap.get(l.project_budget_line_id)
    if (!bl || !projectIds.has(bl.project_id)) continue
    const v = l.reported_quantity * bl.subcontractor_cost_price_snapshot
    approvedValueByProject.set(bl.project_id, (approvedValueByProject.get(bl.project_id) ?? 0) + v)
  }
  // Approved EMs add to delivered value too.
  for (const co of allChangeOrders) {
    if (co.status !== 'approved') continue
    approvedValueByProject.set(co.project_id, (approvedValueByProject.get(co.project_id) ?? 0) + co.total_cost)
  }
  // Order-value per project = sum of assigned budget-line cost.
  const orderValueByProject = new Map<string, number>()
  for (const bl of myLines) {
    orderValueByProject.set(bl.project_id, (orderValueByProject.get(bl.project_id) ?? 0) + bl.budget_quantity * bl.subcontractor_cost_price_snapshot)
  }

  const myProjects = projects
    .filter((p) => projectIds.has(p.id))
    .map((p) => {
      const orderValue = orderValueByProject.get(p.id) ?? 0
      const approvedValue = approvedValueByProject.get(p.id) ?? 0
      const progressPct = orderValue > 0 ? Math.round((approvedValue / orderValue) * 100) : 0
      return {
        id: p.id,
        name: p.name,
        project_number: p.project_number,
        end_date: p.end_date,
        order_value: orderValue,
        approved_value: approvedValue,
        progress_pct: progressPct,
        pending_em_count: pendingCOByProject.get(p.id) ?? 0,
        pending_weekly_count: pendingWRByProject.get(p.id) ?? 0,
        project_managers: pmsByProject.get(p.id) ?? [],
      }
    })

  return NextResponse.json({
    kpi: { ordreverdi, fakturert, fakturerbart, gjenstaaende, produsertIkkeBedt },
    pendingChangeOrders,
    revisionChangeOrders,
    pendingWeeklyReports,
    projects: myProjects,
  })
}
