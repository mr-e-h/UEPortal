import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { resolveEffectiveSub } from '@/lib/tender'
import { fmtProductLabel } from '@/lib/format'
import { emNeedsAction, wrNeedsAction, emNeedsRevision } from '@/lib/attention'
import type {
  Project,
  ProjectSubcontractor,
  ProjectBudgetLine,
  Product,
  User,
  WeeklyReport,
  WeeklyReportLine,
  ChangeOrder,
} from '@/types'

interface ProjectManagerLink {
  project_id: string
  user_id: string
}

interface UEInvoice {
  id: string
  subcontractor_id: string
  project_id: string | null
  amount: number
}

export async function GET(_request: NextRequest) {
  // UE-portal: derive the subcontractor strictly from the (effective) session.
  // Honors super-admin view-as, rejects real admins/byggeleder, and ignores any
  // subcontractor_id in the URL — so one UE can never request another's data.
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const subcontractorId = eff.subId
  const sb = getSupabaseAdmin()

  // Fetch in parallel — scope what we can to this sub at the SQL layer so we
  // don't ship every project's data over the wire.
  const [
    linksRes,
    projectsRes,
    budgetLinesRes,
    productsRes,
    pmLinksRes,
    usersRes,
    wrRes,
    coRes,
    invRes,
  ] = await Promise.all([
    sb.from('project_subcontractors').select('*').eq('subcontractor_id', subcontractorId),
    sb.from('projects').select('*').neq('deleted', true),
    sb.from('project_budget_lines').select('*').eq('assigned_subcontractor_id', subcontractorId),
    sb.from('products').select('id, name, description, unit'),
    sb.from('project_managers').select('project_id, user_id'),
    sb.from('users').select('id, full_name, email, active').eq('active', true),
    sb.from('weekly_reports').select('id, project_id, status').eq('subcontractor_id', subcontractorId),
    sb.from('change_orders').select('id, project_id, status, total_cost').eq('subcontractor_id', subcontractorId),
    sb.from('ue_invoices').select('id, subcontractor_id, project_id, amount').eq('subcontractor_id', subcontractorId),
  ])

  const links = (linksRes.data ?? []) as ProjectSubcontractor[]
  const projects = (projectsRes.data ?? []) as Project[]
  const allBudgetLines = (budgetLinesRes.data ?? []) as ProjectBudgetLine[]
  const allProducts = (productsRes.data ?? []) as Pick<Product, 'id' | 'name' | 'description' | 'unit'>[]
  const pmLinks = (pmLinksRes.data ?? []) as ProjectManagerLink[]
  const allUsers = (usersRes.data ?? []) as Pick<User, 'id' | 'full_name' | 'email'>[]
  const myReports = (wrRes.data ?? []) as Pick<WeeklyReport, 'id' | 'project_id' | 'status'>[]
  const myChangeOrders = (coRes.data ?? []) as Pick<ChangeOrder, 'id' | 'project_id' | 'status' | 'total_cost'>[]
  const myInvoices = (invRes.data ?? []) as UEInvoice[]

  const projectIds = links.map((l) => l.project_id)
  const projectIdSet = new Set(projectIds)

  // Fetch weekly_report_lines just for our reports — without this we'd ship
  // every line in the DB across the wire.
  const approvedReportIds = myReports
    .filter((r) => r.status === 'approved' || r.status === 'partially_approved')
    .map((r) => r.id)
  const wrlRes = approvedReportIds.length > 0
    ? await sb.from('weekly_report_lines').select('id, weekly_report_id, project_budget_line_id, reported_quantity, status').in('weekly_report_id', approvedReportIds)
    : { data: [] as WeeklyReportLine[] }
  const allReportLines = (wrlRes.data ?? []) as WeeklyReportLine[]

  // Lookups
  const productMap = new Map(allProducts.map((p) => [p.id, p]))
  const blMap = new Map(allBudgetLines.map((bl) => [bl.id, bl]))
  const usersById = new Map(allUsers.map((u) => [u.id, u]))

  // Approved-value per project: approved weekly-report lines (qty × cost)
  // PLUS approved change orders (their already-computed total_cost).
  const approvedValueByProject = new Map<string, number>()
  for (const line of allReportLines) {
    if (line.status !== 'approved') continue
    const bl = blMap.get(line.project_budget_line_id)
    if (!bl || !projectIdSet.has(bl.project_id)) continue
    const v = line.reported_quantity * bl.subcontractor_cost_price_snapshot
    approvedValueByProject.set(bl.project_id, (approvedValueByProject.get(bl.project_id) ?? 0) + v)
  }
  for (const co of myChangeOrders) {
    if (co.status !== 'approved') continue
    approvedValueByProject.set(co.project_id, (approvedValueByProject.get(co.project_id) ?? 0) + co.total_cost)
  }

  // Invoiced-amount per project (ue_invoices.project_id may be null when
  // a UE filed an unassigned invoice — those are excluded from per-project
  // totals but still show up in the global fakturert KPI).
  const invoicedByProject = new Map<string, number>()
  for (const inv of myInvoices) {
    if (!inv.project_id) continue
    invoicedByProject.set(inv.project_id, (invoicedByProject.get(inv.project_id) ?? 0) + inv.amount)
  }

  // Order-value (kr) per project = sum of this UE's assigned budget lines on the
  // cost side. Same formula as the dashboard's orderValueByProject so the list
  // and the dashboard agree. UE-eget kosttall — ingen kundepris.
  const budgetValueByProject = new Map<string, number>()
  for (const bl of allBudgetLines) {
    if (!projectIdSet.has(bl.project_id)) continue
    if (!(bl.line_type === 'subcontractor_work' || bl.line_type == null)) continue
    budgetValueByProject.set(
      bl.project_id,
      (budgetValueByProject.get(bl.project_id) ?? 0) + bl.budget_quantity * bl.subcontractor_cost_price_snapshot,
    )
  }

  // Per-project saks-tellinger — samme definisjon som dashboardet, men her per
  // rad slik at prosjektlista kan vise saks-pills uten å åpne hvert prosjekt.
  //   pending_em_count       — EM-er som venter på admin (emNeedsAction)
  //   pending_weekly_count   — ukesrapporter som venter på admin (wrNeedsAction)
  //   revision_count         — EM-er admin har sendt tilbake (UEs egen oppgave)
  const pendingEmByProject = new Map<string, number>()
  const revisionByProject = new Map<string, number>()
  for (const co of myChangeOrders) {
    if (emNeedsAction(co.status)) {
      pendingEmByProject.set(co.project_id, (pendingEmByProject.get(co.project_id) ?? 0) + 1)
    } else if (emNeedsRevision(co.status)) {
      revisionByProject.set(co.project_id, (revisionByProject.get(co.project_id) ?? 0) + 1)
    }
  }
  const pendingWeeklyByProject = new Map<string, number>()
  for (const r of myReports) {
    if (wrNeedsAction(r.status)) {
      pendingWeeklyByProject.set(r.project_id, (pendingWeeklyByProject.get(r.project_id) ?? 0) + 1)
    }
  }

  // PM contacts per project
  const pmsByProject = new Map<string, Array<Pick<User, 'id' | 'full_name' | 'email'>>>()
  for (const link of pmLinks) {
    if (!projectIdSet.has(link.project_id)) continue
    const user = usersById.get(link.user_id)
    if (!user) continue
    const arr = pmsByProject.get(link.project_id) ?? []
    arr.push({ id: user.id, full_name: user.full_name, email: user.email })
    pmsByProject.set(link.project_id, arr)
  }

  const result = projects
    .filter((p) => projectIdSet.has(p.id))
    .map((project) => {
      const assignedLines = allBudgetLines.filter(
        (bl) =>
          bl.project_id === project.id &&
          (bl.line_type === 'subcontractor_work' || bl.line_type == null),
      )
      const linesWithProduct = assignedLines.map((bl) => {
        const product = productMap.get(bl.product_id)
        return {
          id: bl.id,
          product_id: bl.product_id,
          // product_name carries the canonical 'CODE - Name' label so the
          // sub UI doesn't need to special-case description vs name. The
          // separate product_description field stays as the raw code for
          // any callers that still want them apart.
          product_name: fmtProductLabel(product),
          product_description: product?.description ?? '',
          unit: product?.unit ?? '',
          budget_quantity: bl.budget_quantity,
          subcontractor_cost_price_snapshot: bl.subcontractor_cost_price_snapshot,
        }
      })
      return {
        ...project,
        budget_lines: linesWithProduct,
        project_managers: pmsByProject.get(project.id) ?? [],
        // budget_value er UE-ens eget kostbudsjett (ordreverdi på kostsiden) —
        // serveren sender det ferdig summert så klienten slipper å regne det
        // fra budget_lines, og det stemmer med dashboardets order_value.
        budget_value: budgetValueByProject.get(project.id) ?? 0,
        approved_value: approvedValueByProject.get(project.id) ?? 0,
        invoiced_value: invoicedByProject.get(project.id) ?? 0,
        pending_em_count: pendingEmByProject.get(project.id) ?? 0,
        pending_weekly_count: pendingWeeklyByProject.get(project.id) ?? 0,
        revision_count: revisionByProject.get(project.id) ?? 0,
      }
    })

  return NextResponse.json(result)
}
