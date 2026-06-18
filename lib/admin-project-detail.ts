/**
 * Server-side data loader for the admin project-detail page.
 *
 * Mirrors exactly what useProjectData.fetchAll() fetches client-side, but
 * runs in a React Server Component (async function, service_role key, no
 * browser fetch). The RSC calls this once on navigation; the result seeds the
 * client island's state so the page HTML arrives fully populated — zero blank-
 * screen waterfall.
 *
 * After any mutation the client island still calls fetchAll() (17 client
 * fetches) to refresh — this loader is only for the INITIAL server-side load.
 *
 * Auth contract:
 *   - Caller (RSC page.tsx) must have already verified session + role.
 *   - We receive the already-resolved `user` so we can apply PM/byggeleder
 *     scope filtering here exactly as the API routes do.
 *   - Admin (main/company/project_manager) sees full customer economics.
 *     Byggeleder gets customer_price_snapshot and total_customer_value stripped,
 *     matching the API route behaviour in budget-lines, change-orders, products.
 */

import { getSupabaseAdmin } from './supabase'
import { getProjectScope, canSeeCustomerEconomics } from './api-guard'
import { getCachedProducts, getCachedSubcontractors, getCachedSubcontractorPrices } from './cache'
import type { User } from '@/types'
import type {
  Project,
  Product,
  ProjectBudgetLine,
  ReportLine,
  ProjectSubcontractor,
  Subcontractor,
  ChangeOrder,
  ProjectInternalCostEntry,
  SubcontractorProductPrice,
  GanttMilestone,
  ProjectPhase,
  PhaseType,
  BudgetVersion,
  ProjectMonthPlan,
  ProjectInvoice,
  WeeklyReport,
  WeeklyReportLine,
} from '@/types'
import type { WRWithLines, ProjectManagerRow } from '@/app/admin/projects/[id]/useProjectData'

export interface ProjectDetailData {
  project: Project | null
  allProducts: Product[]
  budgetLines: ProjectBudgetLine[]
  reportLines: ReportLine[]
  projectSubs: ProjectSubcontractor[]
  allSubs: Subcontractor[]
  changeOrders: ChangeOrder[]
  internalCosts: ProjectInternalCostEntry[]
  weeklyReportsWL: WRWithLines[]
  subPrices: SubcontractorProductPrice[]
  milestones: GanttMilestone[]
  phases: ProjectPhase[]
  phaseTypes: PhaseType[]
  budgetVersions: BudgetVersion[]
  monthPlans: ProjectMonthPlan[]
  projectManagers: ProjectManagerRow[]
  invoices: ProjectInvoice[]
}

function safeArr<T>(val: unknown): T[] {
  return Array.isArray(val) ? (val as T[]) : []
}

/**
 * Load all data for project `id` server-side in a single parallel round-trip.
 *
 * Returns `null` for `project` when the project does not exist or the user's
 * scope does not include it (caller should redirect to notFound()).
 *
 * scope / economy-gating mirrors each API route's GET handler exactly:
 *   - PM scope    → only projects in project_managers for that user_id
 *   - byggeleder  → only assigned projects, stripped customer economics
 *   - main/company → everything, full economics
 */
export async function loadProjectDetail(
  projectId: string,
  user: User,
): Promise<ProjectDetailData> {
  const sb = getSupabaseAdmin()
  const canEconomy = canSeeCustomerEconomics(user)

  // ── Scope check: does this user have read access to this project? ─────────
  // Mirrors /api/projects/[id] GET: PM-scoped → 404 on out-of-scope project.
  const scope = await getProjectScope(user)

  // Parallel fetch — project-specific queries go direct to DB; global lookup
  // tables (products / subcontractors / prices) come from the Vercel Data Cache
  // so the transatlantic hop is avoided on cache hits.
  const [
    projRes,
    blsRes,
    rlsRes,
    pSubsRes,
    cosRes,
    icsRes,
    wrsRes,
    msRes,
    bvRes,
    mpRes,
    pmsRes,
    phRes,
    ptRes,
    invRes,
    // Cached global tables — resolved in parallel with the DB queries above.
    allProductsRaw,
    allSubs,
    subPrices,
  ] = await Promise.all([
    // 1. project
    sb.from('projects').select('*').eq('id', projectId).neq('deleted', true).maybeSingle<Project>(),
    // 2. budget lines for project
    sb.from('project_budget_lines').select('*').eq('project_id', projectId),
    // 3. report lines for project (mirrors requireAdmin route — admin-only)
    sb.from('report_lines').select('*').eq('project_id', projectId),
    // 4. project subcontractors
    sb.from('project_subcontractors').select('*').eq('project_id', projectId),
    // 5. change orders for project (non-draft, mirrors API behaviour)
    sb.from('change_orders').select('*').eq('project_id', projectId).neq('status', 'draft'),
    // 6. internal costs for project
    sb.from('project_internal_costs').select('*').eq('project_id', projectId),
    // 7. weekly reports for project
    sb.from('weekly_reports').select('*').eq('project_id', projectId),
    // 8. milestones for project
    sb.from('milestones').select('*').eq('project_id', projectId),
    // 9. budget versions for project (ordered ascending)
    sb.from('budget_versions').select('*').eq('project_id', projectId).order('version', { ascending: true }),
    // 10. month plans for project
    sb.from('project_month_plans').select('*').eq('project_id', projectId),
    // 11. project managers (assignment rows)
    sb.from('project_managers').select('*').eq('project_id', projectId),
    // 12. project phases
    sb.from('project_phases').select('*').eq('project_id', projectId),
    // 13. phase types (global registry — changes rarely, but not cached here
    //      since it's not in the hot-path catalogue tables)
    sb.from('phase_types').select('*'),
    // 14. invoices for project
    sb.from('project_invoices').select('*').eq('project_id', projectId),
    // Cached global tables (Vercel Data Cache, no transatlantic hop on hit):
    getCachedProducts(),       // raw rows incl. customer_price — stripped below
    getCachedSubcontractors(), // all subcontractors
    getCachedSubcontractorPrices(), // all UE prices
  ])

  // ── Project scope gate ────────────────────────────────────────────────────
  const project = projRes.data ?? null
  if (!project || (scope && !scope.has(project.id))) {
    // Return a null-project shell; RSC caller will notFound().
    return {
      project: null,
      allProducts: [],
      budgetLines: [],
      reportLines: [],
      projectSubs: [],
      allSubs: [],
      changeOrders: [],
      internalCosts: [],
      weeklyReportsWL: [],
      subPrices: [],
      milestones: [],
      phases: [],
      phaseTypes: [],
      budgetVersions: [],
      monthPlans: [],
      projectManagers: [],
      invoices: [],
    }
  }

  // ── Budget lines — strip customer_price_snapshot for byggeleder ───────────
  let budgetLines = safeArr<ProjectBudgetLine>(blsRes.data)
  if (!canEconomy) {
    budgetLines = budgetLines.map((l) => ({ ...l, customer_price_snapshot: 0 }))
  }

  // ── Change orders — strip customer economics for byggeleder ──────────────
  // Zero-out rather than delete so the array remains ChangeOrder[] typed.
  // Mirrors the API route which uses stripCustomerEconomics (same intent).
  let changeOrders = safeArr<ChangeOrder>(cosRes.data)
  if (!canEconomy) {
    changeOrders = changeOrders.map((co) => ({
      ...co,
      customer_price_snapshot: 0,
      total_customer_value: 0,
      profit: 0,
    }))
  }

  // ── Products — strip customer_price for byggeleder ────────────────────────
  // allProductsRaw comes from getCachedProducts() — raw rows including customer_price.
  // Apply the same active filter the /api/products GET applied, then strip per role.
  let allProducts = allProductsRaw.filter((p) => p.active !== false)
  if (!canEconomy) {
    allProducts = allProducts.map((p) => ({ ...p, customer_price: 0 }))
  }

  // ── Weekly reports with lines ─────────────────────────────────────────────
  const reports = safeArr<WeeklyReport>(wrsRes.data)
  const reportIds = reports.map((r) => r.id)
  let weeklyReportLines: WeeklyReportLine[] = []
  if (reportIds.length > 0) {
    const { data: linesData } = await sb
      .from('weekly_report_lines')
      .select('*')
      .in('weekly_report_id', reportIds)
    weeklyReportLines = safeArr<WeeklyReportLine>(linesData)
  }
  const byReport = new Map<string, WeeklyReportLine[]>()
  for (const l of weeklyReportLines) {
    const arr = byReport.get(l.weekly_report_id) ?? []
    arr.push(l)
    byReport.set(l.weekly_report_id, arr)
  }
  const weeklyReportsWL: WRWithLines[] = reports.map((r) => ({
    ...r,
    lines: byReport.get(r.id) ?? [],
  }))

  // ── Project managers — hydrate with user name + email (mirrors API route) ─
  const pmRows = safeArr<{ id: string; project_id: string; user_id: string }>(pmsRes.data)
  let projectManagers: ProjectManagerRow[] = []
  if (pmRows.length > 0) {
    const userIds = Array.from(new Set(pmRows.map((r) => r.user_id)))
    const { data: usersData } = await sb
      .from('users')
      .select('id, full_name, email')
      .in('id', userIds)
    const userMap = new Map(
      safeArr<{ id: string; full_name: string; email: string }>(usersData).map((u) => [u.id, u]),
    )
    projectManagers = pmRows.map((r) => ({
      user_id: r.user_id,
      user: userMap.get(r.user_id)
        ? { id: r.user_id, full_name: userMap.get(r.user_id)!.full_name, email: userMap.get(r.user_id)!.email }
        : null,
    }))
  }

  return {
    project,
    allProducts,
    budgetLines,
    reportLines: safeArr<ReportLine>(rlsRes.data),
    projectSubs: safeArr<ProjectSubcontractor>(pSubsRes.data),
    allSubs,
    changeOrders,
    internalCosts: safeArr<ProjectInternalCostEntry>(icsRes.data),
    weeklyReportsWL,
    subPrices,
    milestones: safeArr<GanttMilestone>(msRes.data),
    phases: safeArr<ProjectPhase>(phRes.data),
    phaseTypes: safeArr<PhaseType>(ptRes.data),
    budgetVersions: safeArr<BudgetVersion>(bvRes.data),
    monthPlans: safeArr<ProjectMonthPlan>(mpRes.data),
    projectManagers,
    invoices: safeArr<ProjectInvoice>(invRes.data),
  }
}
