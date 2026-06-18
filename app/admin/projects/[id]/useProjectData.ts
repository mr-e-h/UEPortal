'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMe } from '@/lib/useMe'
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
  WeeklyReport,
  WeeklyReportLine,
  ProjectInvoice,
} from '@/types'
import type { ProjectDetailData } from '@/lib/admin-project-detail'

export type WRWithLines = WeeklyReport & { lines: WeeklyReportLine[] }

/** PM assignment row hydrated with the user's public-safe fields. Matches
 *  the shape returned by GET /api/project-managers?project_id=… */
export type ProjectManagerRow = {
  user_id: string
  user: { id: string; full_name: string; email: string } | null
}

function safeArr<T>(val: unknown): T[] {
  return Array.isArray(val) ? val as T[] : []
}

/**
 * Owns every piece of data the project-detail page needs, plus the mutation
 * handlers that bump that data and trigger a refresh.
 *
 * Derived/computed values (totals, BL rows, sub-flow data) stay in the
 * tab components that consume them — they're cheap to recompute and the
 * coupling keeps each tab's logic readable in isolation.
 *
 * Loading state stays inside; pages can render a spinner via `loading`.
 * On a 401 anywhere in the parallel fetch we boot to /login (cookie expired).
 *
 * Optional `initialData` seeds state from SSR so the page renders fully
 * populated immediately (no blank-screen waterfall). fetchAll() still runs
 * after every mutation to keep data fresh.
 */
export function useProjectData(id: string, initialData?: ProjectDetailData) {
  const router = useRouter()
  const { me } = useMe()
  const adminName = me?.full_name ?? 'Admin'

  const [project, setProject] = useState<Project | null>(initialData?.project ?? null)
  const [allProducts, setAllProducts] = useState<Product[]>(initialData?.allProducts ?? [])
  const [budgetLines, setBudgetLines] = useState<ProjectBudgetLine[]>(initialData?.budgetLines ?? [])
  const [reportLines, setReportLines] = useState<ReportLine[]>(initialData?.reportLines ?? [])
  const [projectSubs, setProjectSubs] = useState<ProjectSubcontractor[]>(initialData?.projectSubs ?? [])
  const [allSubs, setAllSubs] = useState<Subcontractor[]>(initialData?.allSubs ?? [])
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>(initialData?.changeOrders ?? [])
  const [internalCosts, setInternalCosts] = useState<ProjectInternalCostEntry[]>(initialData?.internalCosts ?? [])
  const [weeklyReportsWL, setWeeklyReportsWL] = useState<WRWithLines[]>(initialData?.weeklyReportsWL ?? [])
  const [subPrices, setSubPrices] = useState<SubcontractorProductPrice[]>(initialData?.subPrices ?? [])
  const [milestones, setMilestones] = useState<GanttMilestone[]>(initialData?.milestones ?? [])
  const [phases, setPhases] = useState<ProjectPhase[]>(initialData?.phases ?? [])
  const [phaseTypes, setPhaseTypes] = useState<PhaseType[]>(initialData?.phaseTypes ?? [])
  const [budgetVersions, setBudgetVersions] = useState<BudgetVersion[]>(initialData?.budgetVersions ?? [])
  const [monthPlans, setMonthPlans] = useState<ProjectMonthPlan[]>(initialData?.monthPlans ?? [])
  const [projectManagers, setProjectManagers] = useState<ProjectManagerRow[]>(initialData?.projectManagers ?? [])
  const [invoices, setInvoices] = useState<ProjectInvoice[]>(initialData?.invoices ?? [])
  // If we have SSR data, the page is immediately populated — no loading spinner.
  const [loading, setLoading] = useState(!initialData)

  const fetchAll = useCallback(async () => {
    const responses = await Promise.all([
      // Targeted single-project lookup — previously we fetched the whole
      // /api/projects list and ran .find(p.id) in JS, which scaled with
      // total project count instead of being O(1).
      fetch(`/api/projects/${id}`),
      fetch('/api/products'),
      fetch(`/api/budget-lines?project_id=${id}`),
      fetch(`/api/report-lines?project_id=${id}`),
      fetch(`/api/project-subcontractors?project_id=${id}`),
      fetch('/api/subcontractors'),
      fetch(`/api/change-orders?project_id=${id}`),
      fetch(`/api/project-internal-costs?project_id=${id}`),
      fetch(`/api/weekly-reports?project_id=${id}&with_lines=true`),
      fetch('/api/subcontractor-prices'),
      fetch(`/api/milestones?project_id=${id}`),
      fetch(`/api/budget-versions?project_id=${id}`),
      fetch(`/api/project-month-plans?project_id=${id}`),
      fetch(`/api/project-managers?project_id=${id}`),
      fetch(`/api/project-phases?project_id=${id}`),
      fetch('/api/phase-types'),
      fetch(`/api/invoices?project_id=${id}`),
    ])

    if (responses.some((r) => r.status === 401)) {
      router.replace('/login')
      return
    }

    const [proj, prods, bls, rls, pSubs, subs, cos, ics, wrls, sps, ms, bv, mp, pms, ph, pt, inv] = await Promise.all(
      responses.map((r) => r.json())
    )

    // /api/projects/[id] returns the row directly (or { error }) — guard
    // against the error shape so a 404 doesn't crash setProject().
    setProject(proj && typeof proj === 'object' && 'id' in proj ? proj as Project : null)
    setAllProducts(safeArr(prods))
    setBudgetLines(safeArr(bls))
    setReportLines(safeArr(rls))
    setProjectSubs(safeArr(pSubs))
    setAllSubs(safeArr(subs))
    setChangeOrders(safeArr(cos))
    setInternalCosts(safeArr(ics))
    setWeeklyReportsWL(safeArr(wrls))
    setSubPrices(safeArr(sps))
    setMilestones(safeArr(ms))
    setPhases(safeArr(ph))
    setPhaseTypes(safeArr(pt))
    setBudgetVersions(safeArr(bv))
    setMonthPlans(safeArr(mp))
    setProjectManagers(safeArr(pms))
    setInvoices(safeArr(inv))
    setLoading(false)
  }, [id, router])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Mutation handlers ─────────────────────────────────────────────
  // All POST/PUT/DELETE handlers re-run fetchAll() afterwards. Could be
  // optimized to do targeted local updates later, but consistency >
  // perf here while the writes are infrequent.

  const addBudgetLine = useCallback(async (input: {
    product_id: string
    budget_quantity: number
    line_type: string
  }) => {
    await fetch('/api/budget-lines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: id, ...input }),
    })
    await fetchAll()
  }, [id, fetchAll])

  const addSubToProject = useCallback(async (subId: string) => {
    if (!subId) return
    await fetch('/api/project-subcontractors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: id, subcontractor_id: subId }),
    })
    await fetchAll()
  }, [id, fetchAll])

  const removeSubFromProject = useCallback(async (linkId: string) => {
    await fetch(`/api/project-subcontractors?id=${linkId}`, { method: 'DELETE' })
    await fetchAll()
  }, [fetchAll])

  const updateReportStatus = useCallback(async (reportId: string, status: 'approved' | 'rejected') => {
    await fetch(`/api/report-lines/${reportId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    await fetchAll()
  }, [fetchAll])

  const updateChangeOrderStatus = useCallback(async (coId: string, status: 'approved' | 'rejected') => {
    await fetch(`/api/change-orders/${coId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewed_by: adminName }),
    })
    await fetchAll()
  }, [adminName, fetchAll])

  const deleteInternalCost = useCallback(async (entryId: string) => {
    await fetch(`/api/project-internal-costs?id=${entryId}`, { method: 'DELETE' })
    await fetchAll()
  }, [fetchAll])

  return {
    // raw data
    project,
    allProducts,
    budgetLines,
    reportLines,
    projectSubs,
    allSubs,
    changeOrders,
    internalCosts,
    weeklyReportsWL,
    subPrices,
    milestones,
    phases,
    phaseTypes,
    budgetVersions,
    monthPlans,
    projectManagers,
    invoices,
    // state
    loading,
    adminName,
    // mutations
    fetchAll,
    addBudgetLine,
    addSubToProject,
    removeSubFromProject,
    updateReportStatus,
    updateChangeOrderStatus,
    deleteInternalCost,
  }
}
