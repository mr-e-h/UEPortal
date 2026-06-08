import { getSupabaseAdmin } from '@/lib/supabase'
import { fmtProductLabel } from '@/lib/format'
import type {
  Project,
  ProjectBudgetLine,
  WeeklyReport,
  WeeklyReportLine,
  ChangeOrder,
  Subcontractor,
  Product,
} from '@/types'

/**
 * Data-access for the admin "Fakturagrunnlag" (invoice basis) view.
 *
 * This is the first module of the lib/repos/ layer (Fase 1A). It owns the
 * Supabase queries + the assembly of invoice-basis line items, so the API route
 * stays thin. Behaviour is a faithful port of the previous inline route logic:
 * the OUTPUT (lines + summary) is byte-for-byte identical for the same inputs.
 *
 * What changed vs. the old route:
 *   - The old route called readJson() on 7 whole tables (SELECT * FROM each)
 *     and then filtered everything in JS. Here we push the cheap, safe filters
 *     down to SQL (status, project_id, subcontractor_id) so the DB returns far
 *     fewer rows as data grows. The remaining JS filtering (date range,
 *     billed_at, the row assembly + money math) is preserved EXACTLY, including
 *     the documented excludeBilled/change-order quirk.
 *
 * Money math, field names, ordering and the excludeBilled quirk are unchanged.
 */

export type InvoiceBasisFilters = {
  projectId?: string | null
  subcontractorId?: string | null
  from?: string | null // ISO date (YYYY-MM-DD)
  to?: string | null   // ISO date (YYYY-MM-DD)
  excludeBilled?: boolean
  /** PM scope: set of project ids the caller may see, or null for full access. */
  scope?: Set<string> | null
}

export type InvoiceBasisLine = {
  report_line_id?: string
  change_order_id?: string
  project_id: string
  project_name: string
  subcontractor_id: string | null
  subcontractor_name: string
  product_name: string
  unit: string
  quantity: number
  cost_price: number
  sales_price: number
  cost_total: number
  sales_total: number
  date: string
  source: 'report' | 'change_order'
}

export type InvoiceBasisResult = {
  lines: InvoiceBasisLine[]
  summary: {
    line_count: number
    total_cost: number
    total_sales_value: number
    profit: number
    margin: string
  }
}

export async function getInvoiceBasis(filters: InvoiceBasisFilters): Promise<InvoiceBasisResult> {
  const {
    projectId = null,
    subcontractorId = null,
    from = null,
    to = null,
    excludeBilled = true,
    scope = null,
  } = filters

  const sb = getSupabaseAdmin()

  // PM scope short-circuit: if the caller is scoped to an explicit (possibly
  // empty) set of projects and that set is empty, nothing is visible. Mirrors
  // the old behaviour where scope.has(...) would exclude every row.
  const scopeIds = scope ? Array.from(scope) : null
  if (scopeIds && scopeIds.length === 0) {
    return emptyResult()
  }

  // --- Approved weekly reports (server-side filtered) ---------------------
  // Old JS: status in (approved, partially_approved) [+ scope/project/sub].
  let reportsQ = sb
    .from('weekly_reports')
    .select('*')
    .in('status', ['approved', 'partially_approved'])
  if (scopeIds) reportsQ = reportsQ.in('project_id', scopeIds)
  if (projectId) reportsQ = reportsQ.eq('project_id', projectId)
  if (subcontractorId) reportsQ = reportsQ.eq('subcontractor_id', subcontractorId)
  const { data: reportData, error: reportErr } = await reportsQ
  if (reportErr) throw new Error(`getInvoiceBasis weekly_reports: ${reportErr.message}`)
  const approvedReports = (reportData ?? []) as WeeklyReport[]

  // --- Approved change orders (server-side filtered) ----------------------
  // Old JS: status === 'approved' [+ scope/project/sub].
  let cosQ = sb.from('change_orders').select('*').eq('status', 'approved')
  if (scopeIds) cosQ = cosQ.in('project_id', scopeIds)
  if (projectId) cosQ = cosQ.eq('project_id', projectId)
  if (subcontractorId) cosQ = cosQ.eq('subcontractor_id', subcontractorId)
  const { data: coData, error: coErr } = await cosQ
  if (coErr) throw new Error(`getInvoiceBasis change_orders: ${coErr.message}`)
  let approvedCOs = (coData ?? []) as ChangeOrder[]

  // --- Approved report lines for those reports ----------------------------
  const approvedReportIds = approvedReports.map((r) => r.id)
  let approvedLines: WeeklyReportLine[] = []
  if (approvedReportIds.length > 0) {
    let linesQ = sb
      .from('weekly_report_lines')
      .select('*')
      .eq('status', 'approved')
      .in('weekly_report_id', approvedReportIds)
    // billed_at IS NULL when excludeBilled (the default). Same predicate as the
    // old `!l.billed_at`, expressed in SQL.
    if (excludeBilled) linesQ = linesQ.is('billed_at', null)
    const { data: lineData, error: lineErr } = await linesQ
    if (lineErr) throw new Error(`getInvoiceBasis weekly_report_lines: ${lineErr.message}`)
    approvedLines = (lineData ?? []) as WeeklyReportLine[]
  }

  // --- Lookup tables (only the rows we still need) ------------------------
  // budget lines referenced by the approved report lines; products + subs
  // referenced by those budget lines and the change orders.
  const blIds = Array.from(new Set(approvedLines.map((l) => l.project_budget_line_id)))
  let budgetLines: ProjectBudgetLine[] = []
  if (blIds.length > 0) {
    const { data, error } = await sb.from('project_budget_lines').select('*').in('id', blIds)
    if (error) throw new Error(`getInvoiceBasis project_budget_lines: ${error.message}`)
    budgetLines = (data ?? []) as ProjectBudgetLine[]
  }
  const blMap = new Map(budgetLines.map((bl) => [bl.id, bl]))

  // Projects needed: from budget lines (reports) + from change orders.
  const neededProjectIds = new Set<string>()
  for (const bl of budgetLines) neededProjectIds.add(bl.project_id)
  for (const co of approvedCOs) neededProjectIds.add(co.project_id)
  let projects: Project[] = []
  if (neededProjectIds.size > 0) {
    const { data, error } = await sb.from('projects').select('*').in('id', Array.from(neededProjectIds))
    if (error) throw new Error(`getInvoiceBasis projects: ${error.message}`)
    projects = (data ?? []) as Project[]
  }
  const projectMap = new Map(projects.map((p) => [p.id, p]))

  // Subcontractors needed: assigned subs on budget lines + change-order subs.
  const neededSubIds = new Set<string>()
  for (const bl of budgetLines) if (bl.assigned_subcontractor_id) neededSubIds.add(bl.assigned_subcontractor_id)
  for (const co of approvedCOs) neededSubIds.add(co.subcontractor_id)
  let subcontractors: Subcontractor[] = []
  if (neededSubIds.size > 0) {
    const { data, error } = await sb.from('subcontractors').select('*').in('id', Array.from(neededSubIds))
    if (error) throw new Error(`getInvoiceBasis subcontractors: ${error.message}`)
    subcontractors = (data ?? []) as Subcontractor[]
  }
  const subMap = new Map(subcontractors.map((s) => [s.id, s]))

  // Products needed: from budget lines + change orders.
  const neededProductIds = new Set<string>()
  for (const bl of budgetLines) neededProductIds.add(bl.product_id)
  for (const co of approvedCOs) neededProductIds.add(co.product_id)
  let products: Product[] = []
  if (neededProductIds.size > 0) {
    const { data, error } = await sb.from('products').select('*').in('id', Array.from(neededProductIds))
    if (error) throw new Error(`getInvoiceBasis products: ${error.message}`)
    products = (data ?? []) as Product[]
  }
  const productMap = new Map(products.map((p) => [p.id, p]))

  // report id -> date string (submitted_at ?? created_at), as in the old route.
  const wrMap = new Map(approvedReports.map((r) => [r.id, r]))

  // --- Date-range filter on report lines (preserved JS logic) -------------
  if (from || to) {
    const reportDateMap = new Map(approvedReports.map((r) => [r.id, r.submitted_at ?? r.created_at]))
    approvedLines = approvedLines.filter((l) => {
      const dateStr = reportDateMap.get(l.weekly_report_id)
      if (!dateStr) return false
      const d = dateStr.split('T')[0]
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
  }

  // --- excludeBilled quirk on change orders (preserved verbatim) ----------
  // The old route intentionally did NOT exclude any change orders for
  // excludeBilled, because change_orders has no billed_at column yet. Keep that
  // exact behaviour (no-op) so output is identical.
  if (excludeBilled) {
    // no-op until change_orders has billed_at — matches the old route.
  }

  // --- Date-range filter on change orders (preserved JS logic) ------------
  if (from || to) {
    approvedCOs = approvedCOs.filter((co) => {
      const d = (co.reviewed_at ?? co.submitted_at ?? '')?.split('T')[0]
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
  }

  // --- Assemble line items (identical field mapping + money math) ---------
  const lineItems: InvoiceBasisLine[] = []

  for (const line of approvedLines) {
    const bl = blMap.get(line.project_budget_line_id)
    if (!bl) continue
    const report = wrMap.get(line.weekly_report_id)
    if (!report) continue
    const proj = projectMap.get(bl.project_id)
    if (!proj) continue
    const sub = bl.assigned_subcontractor_id ? subMap.get(bl.assigned_subcontractor_id) : null
    const product = productMap.get(bl.product_id)

    lineItems.push({
      report_line_id: line.id,
      project_id: bl.project_id,
      project_name: proj.name,
      subcontractor_id: bl.assigned_subcontractor_id,
      subcontractor_name: sub?.company_name ?? '–',
      product_name: fmtProductLabel(product),
      unit: product?.unit ?? '–',
      quantity: line.reported_quantity,
      cost_price: bl.subcontractor_cost_price_snapshot,
      sales_price: bl.customer_price_snapshot,
      cost_total: line.reported_quantity * bl.subcontractor_cost_price_snapshot,
      sales_total: line.reported_quantity * bl.customer_price_snapshot,
      date: (report.submitted_at ?? report.created_at).split('T')[0],
      source: 'report',
    })
  }

  for (const co of approvedCOs) {
    const proj = projectMap.get(co.project_id)
    if (!proj) continue
    const sub = subMap.get(co.subcontractor_id)
    const product = productMap.get(co.product_id)

    lineItems.push({
      change_order_id: co.id,
      project_id: co.project_id,
      project_name: proj.name,
      subcontractor_id: co.subcontractor_id,
      subcontractor_name: sub?.company_name ?? '–',
      product_name: fmtProductLabel(product),
      unit: co.unit,
      quantity: co.requested_quantity,
      cost_price: co.cost_price_snapshot,
      sales_price: co.customer_price_snapshot,
      cost_total: co.total_cost,
      sales_total: co.total_customer_value,
      date: (co.reviewed_at ?? co.submitted_at ?? '').split('T')[0],
      source: 'change_order',
    })
  }

  const totalCost = lineItems.reduce((s, l) => s + l.cost_total, 0)
  const totalSales = lineItems.reduce((s, l) => s + l.sales_total, 0)

  return {
    lines: lineItems,
    summary: {
      line_count: lineItems.length,
      total_cost: totalCost,
      total_sales_value: totalSales,
      profit: totalSales - totalCost,
      margin: totalSales > 0 ? ((totalSales - totalCost) / totalSales * 100).toFixed(1) : '0.0',
    },
  }
}

function emptyResult(): InvoiceBasisResult {
  return {
    lines: [],
    summary: {
      line_count: 0,
      total_cost: 0,
      total_sales_value: 0,
      profit: 0,
      margin: '0.0',
    },
  }
}

// ============================================================================
// Subcontractor (UE) invoice basis
// ============================================================================
//
// The UE-facing variant. CRITICAL difference from the admin version: the UE may
// ONLY ever see their own cost side. The returned line shape has NO customer
// price, NO sales total, NO profit, NO subcontractor_name — only cost_price /
// cost_total. Scoping is by a single subcontractor_id (the caller's own; the
// route enforces that the caller owns it or is an admin). This is a faithful
// port of the previous inline route logic; output is byte-for-byte identical.
//
// Behaviour preserved exactly:
//   - filter to this subcontractor's approved/partially_approved reports
//   - approved report lines only
//   - approved change orders for this subcontractor
//   - optional project_id + date-range (report submitted_at/created_at) filters
//   - skip lines/COs whose project is missing OR soft-deleted (proj.deleted)
//   - NO excludeBilled concept here (the UE route never had one)

export type SubInvoiceBasisFilters = {
  subcontractorId: string
  projectId?: string | null
  from?: string | null // ISO date (YYYY-MM-DD)
  to?: string | null   // ISO date (YYYY-MM-DD)
}

export type SubInvoiceBasisLine = {
  report_line_id?: string
  change_order_id?: string
  project_id: string
  project_name: string
  product_name: string
  unit: string
  quantity: number
  cost_price: number
  cost_total: number
  date: string
  source: 'report' | 'change_order'
}

export type SubInvoiceBasisResult = {
  lines: SubInvoiceBasisLine[]
  summary: {
    line_count: number
    total_cost: number
  }
}

export async function getSubcontractorInvoiceBasis(
  filters: SubInvoiceBasisFilters,
): Promise<SubInvoiceBasisResult> {
  const { subcontractorId, projectId = null, from = null, to = null } = filters
  const sb = getSupabaseAdmin()

  // --- Approved weekly reports for THIS subcontractor (server filtered) ---
  let reportsQ = sb
    .from('weekly_reports')
    .select('*')
    .eq('subcontractor_id', subcontractorId)
    .in('status', ['approved', 'partially_approved'])
  if (projectId) reportsQ = reportsQ.eq('project_id', projectId)
  const { data: reportData, error: reportErr } = await reportsQ
  if (reportErr) throw new Error(`getSubcontractorInvoiceBasis weekly_reports: ${reportErr.message}`)
  const approvedReports = (reportData ?? []) as WeeklyReport[]

  // --- Approved change orders for THIS subcontractor (server filtered) ----
  let cosQ = sb
    .from('change_orders')
    .select('*')
    .eq('subcontractor_id', subcontractorId)
    .eq('status', 'approved')
  if (projectId) cosQ = cosQ.eq('project_id', projectId)
  const { data: coData, error: coErr } = await cosQ
  if (coErr) throw new Error(`getSubcontractorInvoiceBasis change_orders: ${coErr.message}`)
  let approvedCOs = (coData ?? []) as ChangeOrder[]

  // --- Approved report lines for those reports ----------------------------
  const approvedReportIds = approvedReports.map((r) => r.id)
  let approvedLines: WeeklyReportLine[] = []
  if (approvedReportIds.length > 0) {
    const { data, error } = await sb
      .from('weekly_report_lines')
      .select('*')
      .eq('status', 'approved')
      .in('weekly_report_id', approvedReportIds)
    if (error) throw new Error(`getSubcontractorInvoiceBasis weekly_report_lines: ${error.message}`)
    approvedLines = (data ?? []) as WeeklyReportLine[]
  }

  // --- Lookup tables (only referenced rows) -------------------------------
  const blIds = Array.from(new Set(approvedLines.map((l) => l.project_budget_line_id)))
  let budgetLines: ProjectBudgetLine[] = []
  if (blIds.length > 0) {
    const { data, error } = await sb.from('project_budget_lines').select('*').in('id', blIds)
    if (error) throw new Error(`getSubcontractorInvoiceBasis project_budget_lines: ${error.message}`)
    budgetLines = (data ?? []) as ProjectBudgetLine[]
  }
  const blMap = new Map(budgetLines.map((bl) => [bl.id, bl]))

  const neededProjectIds = new Set<string>()
  for (const bl of budgetLines) neededProjectIds.add(bl.project_id)
  for (const co of approvedCOs) neededProjectIds.add(co.project_id)
  let projects: Project[] = []
  if (neededProjectIds.size > 0) {
    const { data, error } = await sb.from('projects').select('*').in('id', Array.from(neededProjectIds))
    if (error) throw new Error(`getSubcontractorInvoiceBasis projects: ${error.message}`)
    projects = (data ?? []) as Project[]
  }
  const projectMap = new Map(projects.map((p) => [p.id, p]))

  const neededProductIds = new Set<string>()
  for (const bl of budgetLines) neededProductIds.add(bl.product_id)
  for (const co of approvedCOs) neededProductIds.add(co.product_id)
  let products: Product[] = []
  if (neededProductIds.size > 0) {
    const { data, error } = await sb.from('products').select('*').in('id', Array.from(neededProductIds))
    if (error) throw new Error(`getSubcontractorInvoiceBasis products: ${error.message}`)
    products = (data ?? []) as Product[]
  }
  const productMap = new Map(products.map((p) => [p.id, p]))

  const wrMap = new Map(approvedReports.map((r) => [r.id, r]))

  // --- Date-range filter on report lines (preserved JS logic) -------------
  if (from || to) {
    const reportDateMap = new Map(approvedReports.map((r) => [r.id, r.submitted_at ?? r.created_at]))
    approvedLines = approvedLines.filter((l) => {
      const dateStr = reportDateMap.get(l.weekly_report_id)
      if (!dateStr) return false
      const d = dateStr.split('T')[0]
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
  }

  // --- Date-range filter on change orders (preserved JS logic) ------------
  if (from || to) {
    approvedCOs = approvedCOs.filter((co) => {
      const d = (co.reviewed_at ?? co.submitted_at ?? '').split('T')[0]
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
  }

  // --- Assemble (cost-only line shape, deleted projects skipped) ----------
  const lineItems: SubInvoiceBasisLine[] = []

  for (const line of approvedLines) {
    const bl = blMap.get(line.project_budget_line_id)
    if (!bl) continue
    const report = wrMap.get(line.weekly_report_id)
    if (!report) continue
    const proj = projectMap.get(bl.project_id)
    if (!proj || proj.deleted) continue
    const product = productMap.get(bl.product_id)

    lineItems.push({
      report_line_id: line.id,
      project_id: bl.project_id,
      project_name: proj.name,
      product_name: fmtProductLabel(product),
      unit: product?.unit ?? '–',
      quantity: line.reported_quantity,
      cost_price: bl.subcontractor_cost_price_snapshot,
      cost_total: line.reported_quantity * bl.subcontractor_cost_price_snapshot,
      date: (report.submitted_at ?? report.created_at).split('T')[0],
      source: 'report',
    })
  }

  for (const co of approvedCOs) {
    const proj = projectMap.get(co.project_id)
    if (!proj || proj.deleted) continue
    const product = productMap.get(co.product_id)

    lineItems.push({
      change_order_id: co.id,
      project_id: co.project_id,
      project_name: proj.name,
      product_name: fmtProductLabel(product),
      unit: co.unit,
      quantity: co.requested_quantity,
      cost_price: co.cost_price_snapshot,
      cost_total: co.total_cost,
      date: (co.reviewed_at ?? co.submitted_at ?? '').split('T')[0],
      source: 'change_order',
    })
  }

  const totalCost = lineItems.reduce((s, l) => s + l.cost_total, 0)

  return {
    lines: lineItems,
    summary: {
      line_count: lineItems.length,
      total_cost: totalCost,
    },
  }
}
