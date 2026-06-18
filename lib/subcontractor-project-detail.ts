/**
 * Server-side data loader for the subcontractor project-detail page.
 *
 * Mirrors exactly what loadProject() (fetch /api/subcontractor/projects/[id])
 * does client-side, but runs in a React Server Component — no browser fetch,
 * no client-side round-trip, no blank-screen waterfall on first load.
 *
 * Scoping / isolation contract (mirrors the API route exactly):
 *   - resolveEffectiveSub() derives the subcontractor_id from the session,
 *     honouring the super-admin view-as override.
 *   - project_subcontractors membership is checked FIRST (404 if missing).
 *   - Only UE-own cost figures are included. customer_price_snapshot and any
 *     customer-economics fields are never selected — same guarantee as the
 *     API route's UE-PRIS-ISOLASJON comment.
 *   - Parallel fetches mirror the API route's Promise.all block.
 *
 * The RSC page.tsx calls this once on navigation; the result is passed as
 * `initialData` to the client island (ProjectDetailClient) which seeds its
 * `project` state immediately — zero spinner on first render.
 *
 * After mutations the client island still calls loadProject() (one client
 * fetch) to refresh — only the INITIAL load is moved server-side.
 */

import { getSession } from './auth'
import { getEffectiveUser } from './view-as'
import { getSupabaseAdmin } from './supabase'
import { fmtProductLabel } from './format'
import { emNeedsAction, wrNeedsAction, emNeedsRevision } from './attention'
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

// ── Types that mirror the shape consumed by the client island ────────────────

export type BudgetLineWithProduct = {
  id: string
  product_id: string
  product_name: string
  product_description: string
  unit: string
  budget_quantity: number
  subcontractor_cost_price_snapshot: number
}

export type ProjectManager = { id: string; full_name: string; email: string }

/** Shape returned to the client island — identical to the API route response */
export type SubcontractorProjectData = Omit<Project, never> & {
  budget_lines: BudgetLineWithProduct[]
  project_managers: ProjectManager[]
  budget_value: number
  approved_value: number
  invoiced_value: number
  pending_em_count: number
  pending_weekly_count: number
  revision_count: number
}

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

function safeArr<T>(val: unknown): T[] {
  return Array.isArray(val) ? (val as T[]) : []
}

/**
 * Resolve sub identity server-side (mirrors resolveEffectiveSub from
 * lib/tender.ts but inlined here to avoid a circular dep with tender.ts
 * which imports activity helpers). Returns null when not a sub.
 */
async function resolveSubId(): Promise<{ user: User; subId: string } | null> {
  const real = await getSession()
  if (!real) return null
  const eff = await getEffectiveUser(real)
  if (eff.role !== 'sub' || !eff.subcontractor_id) return null
  return { user: eff, subId: eff.subcontractor_id }
}

/**
 * Load initial project data for the subcontractor project-detail page.
 *
 * Returns null in these cases (caller should call notFound()):
 *   - no valid session / not a sub
 *   - project not found or deleted
 *   - sub is not linked to this project via project_subcontractors
 *
 * UE-PRIS-ISOLASJON: We never select customer_price_snapshot,
 * total_customer_value, or profit. Only subcontractor_cost_price_snapshot
 * and total_cost (UE's own) are included.
 */
export async function loadSubcontractorProjectDetail(
  projectId: string,
): Promise<SubcontractorProjectData | null> {
  const eff = await resolveSubId()
  if (!eff) return null

  const subcontractorId = eff.subId
  const sb = getSupabaseAdmin()

  // Ownership gate FIRST — mirrors the API route.
  const linkRes = await sb
    .from('project_subcontractors')
    .select('*')
    .eq('subcontractor_id', subcontractorId)
    .eq('project_id', projectId)
    .maybeSingle<ProjectSubcontractor>()

  if (!linkRes.data) return null

  // Fetch project
  const projectRes = await sb
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .neq('deleted', true)
    .maybeSingle<Project>()

  if (!projectRes.data) return null
  const project = projectRes.data

  // Parallel fetches — mirrors the API route's Promise.all block
  const [
    budgetLinesRes,
    productsRes,
    pmLinksRes,
    usersRes,
    wrRes,
    coRes,
    invRes,
  ] = await Promise.all([
    sb
      .from('project_budget_lines')
      .select('*')
      .eq('assigned_subcontractor_id', subcontractorId)
      .eq('project_id', projectId),
    sb.from('products').select('id, name, description, unit'),
    sb
      .from('project_managers')
      .select('project_id, user_id')
      .eq('project_id', projectId),
    sb.from('users').select('id, full_name, email, active').eq('active', true),
    sb
      .from('weekly_reports')
      .select('id, project_id, status')
      .eq('subcontractor_id', subcontractorId)
      .eq('project_id', projectId),
    sb
      .from('change_orders')
      .select('id, project_id, status, total_cost')
      .eq('subcontractor_id', subcontractorId)
      .eq('project_id', projectId),
    sb
      .from('ue_invoices')
      .select('id, subcontractor_id, project_id, amount')
      .eq('subcontractor_id', subcontractorId)
      .eq('project_id', projectId),
  ])

  const allBudgetLines = safeArr<ProjectBudgetLine>(budgetLinesRes.data)
  const allProducts = safeArr<Pick<Product, 'id' | 'name' | 'description' | 'unit'>>(productsRes.data)
  const pmLinks = safeArr<ProjectManagerLink>(pmLinksRes.data)
  const allUsers = safeArr<Pick<User, 'id' | 'full_name' | 'email'>>(usersRes.data)
  const myReports = safeArr<Pick<WeeklyReport, 'id' | 'project_id' | 'status'>>(wrRes.data)
  const myChangeOrders = safeArr<Pick<ChangeOrder, 'id' | 'project_id' | 'status' | 'total_cost'>>(coRes.data)
  const myInvoices = safeArr<UEInvoice>(invRes.data)

  // Fetch weekly report lines for approved reports only — mirrors API route
  const approvedReportIds = myReports
    .filter((r) => r.status === 'approved' || r.status === 'partially_approved')
    .map((r) => r.id)

  const wrlRes =
    approvedReportIds.length > 0
      ? await sb
          .from('weekly_report_lines')
          .select('id, weekly_report_id, project_budget_line_id, reported_quantity, status')
          .in('weekly_report_id', approvedReportIds)
      : { data: [] as WeeklyReportLine[] }
  const allReportLines = safeArr<WeeklyReportLine>(wrlRes.data)

  // Lookups
  const productMap = new Map(allProducts.map((p) => [p.id, p]))
  const blMap = new Map(allBudgetLines.map((bl) => [bl.id, bl]))
  const usersById = new Map(allUsers.map((u) => [u.id, u]))

  // approved_value — same formula as the API route
  let approvedValue = 0
  for (const line of allReportLines) {
    if (line.status !== 'approved') continue
    const bl = blMap.get(line.project_budget_line_id)
    if (!bl || bl.project_id !== projectId) continue
    approvedValue += line.reported_quantity * bl.subcontractor_cost_price_snapshot
  }
  for (const co of myChangeOrders) {
    if (co.status !== 'approved') continue
    approvedValue += co.total_cost
  }

  // invoiced_value
  let invoicedValue = 0
  for (const inv of myInvoices) {
    if (!inv.project_id) continue
    invoicedValue += inv.amount
  }

  // budget_value
  let budgetValue = 0
  for (const bl of allBudgetLines) {
    if (bl.project_id !== projectId) continue
    if (!(bl.line_type === 'subcontractor_work' || bl.line_type == null)) continue
    budgetValue += bl.budget_quantity * bl.subcontractor_cost_price_snapshot
  }

  // Status counts
  let pendingEmCount = 0
  let revisionCount = 0
  for (const co of myChangeOrders) {
    if (emNeedsAction(co.status)) pendingEmCount += 1
    else if (emNeedsRevision(co.status)) revisionCount += 1
  }
  let pendingWeeklyCount = 0
  for (const r of myReports) {
    if (wrNeedsAction(r.status)) pendingWeeklyCount += 1
  }

  // PM contacts
  const projectManagers: ProjectManager[] = []
  for (const link of pmLinks) {
    if (link.project_id !== projectId) continue
    const user = usersById.get(link.user_id)
    if (!user) continue
    projectManagers.push({ id: user.id, full_name: user.full_name, email: user.email })
  }

  // Budget lines enriched with product label — mirrors the API route
  const assignedLines = allBudgetLines.filter(
    (bl) =>
      bl.project_id === project.id &&
      (bl.line_type === 'subcontractor_work' || bl.line_type == null),
  )
  const linesWithProduct: BudgetLineWithProduct[] = assignedLines.map((bl) => {
    const product = productMap.get(bl.product_id)
    return {
      id: bl.id,
      product_id: bl.product_id,
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
    project_managers: projectManagers,
    budget_value: budgetValue,
    approved_value: approvedValue,
    invoiced_value: invoicedValue,
    pending_em_count: pendingEmCount,
    pending_weekly_count: pendingWeeklyCount,
    revision_count: revisionCount,
  }
}
