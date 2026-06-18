/**
 * Server-side data loader for the UE (subcontractor) projects list page.
 *
 * Extracts the data logic that previously lived inside the API route handler
 * so that BOTH the API route (/api/subcontractor/projects) AND the new RSC
 * page.tsx can call it without duplicating a line of code and without adding
 * an extra HTTP hop from the RSC.
 *
 * UE-PRIS-ISOLASJON: this loader ONLY returns the sub's own cost figures
 * (budget_value, approved_value, invoiced_value — all derived from
 * subcontractor_cost_price_snapshot). The three customer-price fields
 * (customer_price_snapshot, total_customer_value, profit) are never read from
 * the database here. This mirrors the original API route exactly.
 *
 * Auth contract:
 *   - Caller must have already resolved the effective subcontractor id from the
 *     session (never from URL parameters). Pass it in as `subId`.
 *   - Returns an empty array when subId is falsy (view-as without a sub).
 */

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

export type BudgetLineLite = {
  id: string
  product_id: string
  product_name: string
  product_description: string
  unit: string
  budget_quantity: number
  subcontractor_cost_price_snapshot: number
}

export type ProjectManagerLite = {
  id: string
  full_name: string
  email: string
}

export type SubcontractorProjectWithLines = Project & {
  budget_lines: BudgetLineLite[]
  project_managers: ProjectManagerLite[]
  budget_value: number
  approved_value: number
  invoiced_value: number
  pending_em_count: number
  pending_weekly_count: number
  revision_count: number
}

export async function getSubcontractorProjects(subId: string): Promise<SubcontractorProjectWithLines[]> {
  if (!subId) return []

  const sb = getSupabaseAdmin()

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
    sb.from('project_subcontractors').select('*').eq('subcontractor_id', subId),
    sb.from('projects').select('*').neq('deleted', true),
    sb.from('project_budget_lines').select('*').eq('assigned_subcontractor_id', subId),
    sb.from('products').select('id, name, description, unit'),
    sb.from('project_managers').select('project_id, user_id'),
    sb.from('users').select('id, full_name, email, active').eq('active', true),
    sb.from('weekly_reports').select('id, project_id, status').eq('subcontractor_id', subId),
    sb.from('change_orders').select('id, project_id, status, total_cost').eq('subcontractor_id', subId),
    sb.from('ue_invoices').select('id, subcontractor_id, project_id, amount').eq('subcontractor_id', subId),
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

  const approvedReportIds = myReports
    .filter((r) => r.status === 'approved' || r.status === 'partially_approved')
    .map((r) => r.id)
  const wrlRes = approvedReportIds.length > 0
    ? await sb.from('weekly_report_lines')
        .select('id, weekly_report_id, project_budget_line_id, reported_quantity, status')
        .in('weekly_report_id', approvedReportIds)
    : { data: [] as WeeklyReportLine[] }
  const allReportLines = (wrlRes.data ?? []) as WeeklyReportLine[]

  const productMap = new Map(allProducts.map((p) => [p.id, p]))
  const blMap = new Map(allBudgetLines.map((bl) => [bl.id, bl]))
  const usersById = new Map(allUsers.map((u) => [u.id, u]))

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

  const invoicedByProject = new Map<string, number>()
  for (const inv of myInvoices) {
    if (!inv.project_id) continue
    invoicedByProject.set(inv.project_id, (invoicedByProject.get(inv.project_id) ?? 0) + inv.amount)
  }

  const budgetValueByProject = new Map<string, number>()
  for (const bl of allBudgetLines) {
    if (!projectIdSet.has(bl.project_id)) continue
    if (!(bl.line_type === 'subcontractor_work' || bl.line_type == null)) continue
    budgetValueByProject.set(
      bl.project_id,
      (budgetValueByProject.get(bl.project_id) ?? 0) + bl.budget_quantity * bl.subcontractor_cost_price_snapshot,
    )
  }

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

  const pmsByProject = new Map<string, ProjectManagerLite[]>()
  for (const link of pmLinks) {
    if (!projectIdSet.has(link.project_id)) continue
    const user = usersById.get(link.user_id)
    if (!user) continue
    const arr = pmsByProject.get(link.project_id) ?? []
    arr.push({ id: user.id, full_name: user.full_name, email: user.email })
    pmsByProject.set(link.project_id, arr)
  }

  return projects
    .filter((p) => projectIdSet.has(p.id))
    .map((project) => {
      const assignedLines = allBudgetLines.filter(
        (bl) =>
          bl.project_id === project.id &&
          (bl.line_type === 'subcontractor_work' || bl.line_type == null),
      )
      const linesWithProduct: BudgetLineLite[] = assignedLines.map((bl) => {
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
        project_managers: pmsByProject.get(project.id) ?? [],
        budget_value: budgetValueByProject.get(project.id) ?? 0,
        approved_value: approvedValueByProject.get(project.id) ?? 0,
        invoiced_value: invoicedByProject.get(project.id) ?? 0,
        pending_em_count: pendingEmByProject.get(project.id) ?? 0,
        pending_weekly_count: pendingWeeklyByProject.get(project.id) ?? 0,
        revision_count: revisionByProject.get(project.id) ?? 0,
      }
    })
}
