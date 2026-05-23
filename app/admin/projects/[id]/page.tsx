'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useMe } from '@/lib/useMe'
import { Download } from 'lucide-react'
import type { Project, Product, ProjectBudgetLine, ReportLine, ProjectSubcontractor, Subcontractor, ChangeOrder, WeeklyReport, WeeklyReportLine, ProjectInternalCostEntry, SubcontractorProductPrice, GanttMilestone, BudgetVersion, ProjectMonthPlan } from '@/types'
import SortableTable from '@/components/SortableTable'
import NumberInput from '@/components/NumberInput'
import ConfirmDialog from '@/components/ConfirmDialog'

// Tab content lazy-loaded — most users land on the default tab and don't
// touch Gantt/Invoices/Change orders right away. Defers ~30-60 KB of JS.
const InvoicesSection = dynamic(() => import('./InvoicesSection'), { ssr: false })
const ChangeOrdersSection = dynamic(() => import('./ChangeOrdersSection'), { ssr: false })
const GanttSection = dynamic(() => import('./GanttSection'), { ssr: false })
const BudgetLineChart = dynamic(() => import('@/components/BudgetLineChart'), { ssr: false })
import ReportingsSection from './ReportingsSection'
import InternalCostsSection from './InternalCostsSection'
import MaterialSection from './MaterialSection'
import { fmtNOK as fmt } from '@/lib/format'
import { reportLineStatus } from '@/lib/statuses'
import { lineTypeLabel } from '@/lib/line-types'

const TABS = [
  { id: 'oversikt', label: 'Oversikt' },
  { id: 'budsjettlinjer', label: 'Budsjettlinjer' },
  { id: 'prognose', label: 'Prognose' },
  { id: 'interne', label: 'Interne kostnader' },
  { id: 'materiell', label: 'Materiell' },
  { id: 'rapporteringer', label: 'Rapporteringer' },
  { id: 'endringsmeldinger', label: 'Endringsmeldinger' },
  { id: 'fakturagrunnlag', label: 'Fakturagrunnlag' },
] as const
type ActiveTab = (typeof TABS)[number]['id']

type BLRow = {
  id: string
  product_code: string
  product_name: string
  unit: string
  source: string
  budget_quantity: number
  customer_price_snapshot: number
  sales_value: number
  assigned_subcontractor_id: string | null
  assigned_name: string
  subcontractor_cost_price_snapshot: number
  cost_value: number
  profit: number
  line_type: string
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [activeTab, setActiveTab] = useState<ActiveTab>('oversikt')

  const [project, setProject] = useState<Project | null>(null)
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [budgetLines, setBudgetLines] = useState<ProjectBudgetLine[]>([])
  const [reportLines, setReportLines] = useState<ReportLine[]>([])
  const [projectSubs, setProjectSubs] = useState<ProjectSubcontractor[]>([])
  const [allSubs, setAllSubs] = useState<Subcontractor[]>([])
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([])
  const [loading, setLoading] = useState(true)

  const [showAddLine, setShowAddLine] = useState(false)
  const [newLine, setNewLine] = useState({ product_id: '', budget_quantity: '', line_type: 'subcontractor_work' })
  const [savingLine, setSavingLine] = useState(false)

  const [subPrices, setSubPrices] = useState<SubcontractorProductPrice[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [bulkSubcontractor, setBulkSubcontractor] = useState('')
  const [bulkError, setBulkError] = useState('')
  const [missingPriceDialog, setMissingPriceDialog] = useState<{ subId: string; subName: string; products: Product[] } | null>(null)

  const [addSubId, setAddSubId] = useState('')
  const { me } = useMe()
  const adminName = me?.full_name ?? 'Admin'

  const [internalCosts, setInternalCosts] = useState<ProjectInternalCostEntry[]>([])

  const [milestones, setMilestones] = useState<GanttMilestone[]>([])
  const [budgetVersions, setBudgetVersions] = useState<BudgetVersion[]>([])
  const [monthPlans, setMonthPlans] = useState<ProjectMonthPlan[]>([])

  const [confirmRemoveSubId, setConfirmRemoveSubId] = useState<string | null>(null)
  const [confirmDeleteCostId, setConfirmDeleteCostId] = useState<string | null>(null)
  const [chartLineId, setChartLineId] = useState<string | null>(null)

  // Line type filter for Budsjettlinjer tab
  const [lineTypeFilter, setLineTypeFilter] = useState<string>('all')

  type WRWithLines = WeeklyReport & { lines: WeeklyReportLine[] }
  const [weeklyReportsWL, setWeeklyReportsWL] = useState<WRWithLines[]>([])
  const [expandedSub, setExpandedSub] = useState<string | null>(null)

  // Excel post-import
  const importFileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState('')
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const safeArr = <T,>(val: unknown): T[] => Array.isArray(val) ? val as T[] : []

  const fetchAll = useCallback(async () => {
    const responses = await Promise.all([
      fetch('/api/projects'),
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
    ])

    if (responses.some((r) => r.status === 401)) {
      router.replace('/login')
      return
    }

    const [allProj, prods, bls, rls, pSubs, subs, cos, ics, wrls, sps, ms, bv, mp] = await Promise.all(
      responses.map((r) => r.json())
    )

    setProject(safeArr<Project>(allProj).find((p) => p.id === id) ?? null)
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
    setBudgetVersions(safeArr(bv))
    setMonthPlans(safeArr(mp))
    setLoading(false)
  }, [id, router])

  useEffect(() => {
    // Restore pending assignment if coming back from the prices page
    try {
      const pending = sessionStorage.getItem('pending_assignment')
      if (pending) {
        const { projectId: savedId, selected: savedSelected, bulkSubcontractor: savedSub } = JSON.parse(pending) as {
          projectId: string; selected: string[]; bulkSubcontractor: string
        }
        if (savedId === id) {
          setSelected(savedSelected)
          setBulkSubcontractor(savedSub)
          sessionStorage.removeItem('pending_assignment')
        }
      }
    } catch {}

    fetchAll()
  }, [fetchAll, id])

  async function addBudgetLine(e: React.FormEvent) {
    e.preventDefault()
    setSavingLine(true)
    await fetch('/api/budget-lines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: id, product_id: newLine.product_id, budget_quantity: Number(newLine.budget_quantity), line_type: newLine.line_type }),
    })
    setNewLine({ product_id: '', budget_quantity: '', line_type: 'subcontractor_work' })
    setShowAddLine(false)
    setSavingLine(false)
    fetchAll()
  }

  async function handleBulkAssign() {
    if (!bulkSubcontractor || selected.length === 0) return
    setBulkError('')

    if (bulkSubcontractor !== '__intern__') {
      const missingProducts = selected
        .map((lineId) => budgetLines.find((b) => b.id === lineId)?.product_id)
        .filter((pid): pid is string => !!pid)
        .filter((pid) => !subPrices.find((sp) => sp.subcontractor_id === bulkSubcontractor && sp.product_id === pid))
        .map((pid) => allProducts.find((p) => p.id === pid))
        .filter((p): p is Product => !!p)

      if (missingProducts.length > 0) {
        setMissingPriceDialog({
          subId: bulkSubcontractor,
          subName: projectSubDetails.find((s) => s.id === bulkSubcontractor)?.company_name ?? '',
          products: missingProducts,
        })
        return
      }
    }

    const results = await Promise.all(
      selected.map((lineId) =>
        fetch('/api/budget-lines', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: lineId, assigned_subcontractor_id: bulkSubcontractor }),
        })
      )
    )
    if (results.some((r) => !r.ok)) {
      setBulkError('En eller flere produkter mangler pris for valgt UE.')
    } else {
      setSelected([])
      setBulkSubcontractor('')
    }
    fetchAll()
  }

  async function addSubToProject() {
    if (!addSubId) return
    await fetch('/api/project-subcontractors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: id, subcontractor_id: addSubId }),
    })
    setAddSubId('')
    fetchAll()
  }

  async function removeSubFromProject(linkId: string) {
    await fetch(`/api/project-subcontractors?id=${linkId}`, { method: 'DELETE' })
    fetchAll()
  }

  async function updateReportStatus(reportId: string, status: 'approved' | 'rejected') {
    await fetch(`/api/report-lines/${reportId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    fetchAll()
  }

  async function handlePostImport(file: File) {
    setImporting(true)
    setImportMsg('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('uploaded_by', adminName)
    const res = await fetch(`/api/projects/${id}/import`, { method: 'POST', body: fd })
    const data = await res.json() as {
      added?: number; updated?: number; new_products?: number; error?: string
      updated_fields?: { name?: string; project_number?: string; order_number?: string }
    }
    if (res.ok) {
      const parts = []
      if ((data.added ?? 0) > 0) parts.push(`${data.added} nye linjer`)
      if ((data.updated ?? 0) > 0) parts.push(`${data.updated} oppdatert`)
      if ((data.new_products ?? 0) > 0) parts.push(`${data.new_products} nye produkter`)
      const uf = data.updated_fields ?? {}
      if (uf.name) parts.push(`navn → «${uf.name}»`)
      if (uf.project_number) parts.push(`prosjektnr → ${uf.project_number}`)
      if (uf.order_number) parts.push(`ordrenr → ${uf.order_number}`)
      setImportMsg(parts.length > 0 ? parts.join(' · ') : 'Ingen endringer')
      fetchAll()
    } else {
      setImportMsg(data.error ?? 'Import feilet')
    }
    setImporting(false)
  }

  async function updateCOStatus(coId: string, status: 'approved' | 'rejected') {
    await fetch(`/api/change-orders/${coId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewed_by: adminName }),
    })
    fetchAll()
  }

  async function deleteInternalCost(entryId: string) {
    await fetch(`/api/project-internal-costs?id=${entryId}`, { method: 'DELETE' })
    fetchAll()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Laster...</div>
  if (!project) return <div className="flex items-center justify-center h-64 text-gray-500">Prosjekt ikke funnet</div>

  const manualLines = budgetLines.filter((bl) => !bl.source || bl.source === 'manual')

  const originalBudgetSales = manualLines.reduce((s, bl) => s + bl.budget_quantity * bl.customer_price_snapshot, 0)
  const originalBudgetCost = manualLines.filter((bl) => bl.assigned_subcontractor_id).reduce((s, bl) => s + bl.budget_quantity * bl.subcontractor_cost_price_snapshot, 0)

  const approvedCOs = changeOrders.filter((co) => co.status === 'approved')
  const coAddedSales = approvedCOs.reduce((s, co) => s + co.total_customer_value, 0)
  const coAddedCost = approvedCOs.reduce((s, co) => s + co.total_cost, 0)

  const totalSales = originalBudgetSales + coAddedSales
  const totalCost = originalBudgetCost + coAddedCost

  const assignedSubIds = new Set(projectSubs.map((ps) => ps.subcontractor_id))
  const projectSubDetails = allSubs.filter((s) => assignedSubIds.has(s.id))
  const availableSubs = allSubs.filter((s) => s.active && !assignedSubIds.has(s.id))

  const totalInternalCost = internalCosts.reduce((s, c) => s + c.amount, 0)

  const allChecked = selected.length === budgetLines.length && budgetLines.length > 0
  const toggleAll = () => setSelected(allChecked ? [] : budgetLines.map((l) => l.id))

  // UE economic flow data
  const approvedWRLines = weeklyReportsWL
    .filter((wr) => wr.status === 'approved' || wr.status === 'partially_approved')
    .flatMap((wr) => wr.lines.filter((l) => l.status === 'approved'))

  type SubFlowProduct = {
    id: string; name: string; unit: string
    budgetQty: number; reportedQty: number
    budgetCost: number; reportedCost: number; pct: number
  }
  type SubFlow = {
    id: string; name: string
    budgetCost: number; budgetSales: number
    reportedCost: number; remaining: number; pct: number
    products: SubFlowProduct[]
  }

  const subFlowData: SubFlow[] = projectSubDetails.map((sub) => {
    const subBudgetLines = budgetLines.filter((bl) => bl.assigned_subcontractor_id === sub.id)
    const budgetCost = subBudgetLines.reduce((s, bl) => s + bl.budget_quantity * bl.subcontractor_cost_price_snapshot, 0)
    const budgetSales = subBudgetLines.reduce((s, bl) => s + bl.budget_quantity * bl.customer_price_snapshot, 0)
    const subApprovedLines = approvedWRLines.filter((l) => {
      const bl = budgetLines.find((b) => b.id === l.project_budget_line_id)
      return bl?.assigned_subcontractor_id === sub.id
    })
    const ueReportedCost = subApprovedLines.reduce((s, l) => {
      const bl = budgetLines.find((b) => b.id === l.project_budget_line_id)
      return s + l.reported_quantity * (bl?.subcontractor_cost_price_snapshot ?? 0)
    }, 0)
    const products: SubFlowProduct[] = subBudgetLines.map((bl) => {
      const product = allProducts.find((p) => p.id === bl.product_id)
      const reportedForLine = subApprovedLines
        .filter((l) => l.project_budget_line_id === bl.id)
        .reduce((s, l) => s + l.reported_quantity, 0)
      return {
        id: bl.id,
        name: product?.name ?? '–',
        unit: product?.unit ?? '–',
        budgetQty: bl.budget_quantity,
        reportedQty: reportedForLine,
        budgetCost: bl.budget_quantity * bl.subcontractor_cost_price_snapshot,
        reportedCost: reportedForLine * bl.subcontractor_cost_price_snapshot,
        pct: bl.budget_quantity > 0 ? Math.round((reportedForLine / bl.budget_quantity) * 100) : 0,
      }
    })
    return {
      id: sub.id,
      name: sub.company_name,
      budgetCost,
      budgetSales,
      reportedCost: ueReportedCost,
      remaining: Math.max(0, budgetCost - ueReportedCost),
      pct: budgetCost > 0 ? Math.round((ueReportedCost / budgetCost) * 100) : 0,
      products,
    }
  })

  // Prognose totals from monthly plan entries
  const forecastRevenue = monthPlans.reduce((s, m) => s + (m.expected_revenue ?? 0), 0)
  const forecastUECost = monthPlans.reduce((s, m) => s + (m.ue_cost ?? 0), 0)
  const forecastInternalCost = monthPlans.reduce((s, m) => s + (m.internal_cost ?? 0), 0)
  const forecastOtherCost = monthPlans.reduce((s, m) => s + (m.other_cost ?? 0), 0)
  const forecastProfit = forecastRevenue - forecastUECost - forecastInternalCost - forecastOtherCost
  const hasForecast = forecastRevenue > 0 || forecastUECost > 0 || forecastInternalCost > 0

  const totalUEBudgetCost = subFlowData.reduce((s, sf) => s + sf.budgetCost, 0)
  const totalUEReportedCost = subFlowData.reduce((s, sf) => s + sf.reportedCost, 0)

  const internLines = budgetLines.filter((bl) => bl.assigned_subcontractor_id === '__intern__')
  const internBudgetSales = internLines.reduce((s, bl) => s + bl.budget_quantity * bl.customer_price_snapshot, 0)
  const internPct = internBudgetSales > 0 ? Math.round((totalInternalCost / internBudgetSales) * 100) : 0

  const toggleRow = (rowId: string) => setSelected((prev) => prev.includes(rowId) ? prev.filter((x) => x !== rowId) : [...prev, rowId])

  // Build BLRows
  const buildBLRows = (lines: ProjectBudgetLine[]): BLRow[] => lines.map((bl) => {
    const product = allProducts.find((p) => p.id === bl.product_id)
    const isIntern = bl.assigned_subcontractor_id === '__intern__'
    const assignedSub = isIntern ? null : allSubs.find((s) => s.id === bl.assigned_subcontractor_id)
    const salesValue = bl.budget_quantity * bl.customer_price_snapshot
    const costValue = bl.assigned_subcontractor_id && !isIntern ? bl.budget_quantity * bl.subcontractor_cost_price_snapshot : 0
    return {
      id: bl.id,
      product_code: product?.description ?? '–',
      product_name: product?.name ?? '–',
      unit: product?.unit ?? '–',
      source: bl.source ?? 'manual',
      budget_quantity: bl.budget_quantity,
      customer_price_snapshot: bl.customer_price_snapshot,
      sales_value: salesValue,
      assigned_subcontractor_id: bl.assigned_subcontractor_id,
      assigned_name: isIntern ? 'Intern / Netel' : (assignedSub?.company_name ?? ''),
      subcontractor_cost_price_snapshot: bl.subcontractor_cost_price_snapshot,
      cost_value: costValue,
      profit: salesValue - costValue,
      line_type: bl.line_type ?? 'subcontractor_work',
    }
  })

  const expandedRowRenderFn = (row: BLRow) => {
    const bl = budgetLines.find((b) => b.id === row.id)
    if (!bl) return null
    const product = allProducts.find((p) => p.id === bl.product_id)
    const sub = allSubs.find((s) => s.id === bl.assigned_subcontractor_id)
    const cos = changeOrders
      .filter((co) =>
        co.product_id === bl.product_id &&
        co.subcontractor_id === bl.assigned_subcontractor_id &&
        co.status === 'approved' &&
        co.reviewed_at != null
      )
      .sort((a, b) => a.reviewed_at!.localeCompare(b.reviewed_at!))
    const coTotal = cos.reduce((s, co) => s + co.requested_quantity, 0)
    return (
      <BudgetLineChart
        productName={product?.name ?? row.product_name}
        productCode={product?.description}
        unit={product?.unit ?? row.unit}
        subName={sub?.company_name}
        importQty={bl.budget_quantity - coTotal}
        projectStart={project?.start_date ?? ''}
        approvedCOs={cos}
      />
    )
  }

  const blColumns = [
    {
      key: 'select',
      label: '',
      render: (row: BLRow) => (
        <input
          type="checkbox"
          checked={selected.includes(row.id)}
          onChange={() => toggleRow(row.id)}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4"
        />
      ),
    },
    { key: 'product_code', label: 'Kode', sortable: true },
    { key: 'product_name', label: 'Produkt', sortable: true, tdClassName: 'truncate max-w-0' },
    { key: 'unit', label: 'Enhet' },
    {
      key: 'line_type',
      label: 'Type',
      sortable: true,
      render: (row: BLRow) => {
        const colors: Record<string, string> = {
          subcontractor_work: 'bg-blue-50 text-blue-700',
          internal_cost: 'bg-indigo-50 text-indigo-700',
          material: 'bg-orange-50 text-orange-700',
        }
        return (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[row.line_type] ?? 'bg-gray-100 text-gray-600'}`}>
            {lineTypeLabel(row.line_type)}
          </span>
        )
      },
    },
    { key: 'budget_quantity', label: 'Mengde', sortable: true },
    { key: 'customer_price_snapshot', label: 'Utsalgspris', sortable: true, render: (row: BLRow) => fmt(row.customer_price_snapshot) },
    { key: 'sales_value', label: 'Salgsverdi', sortable: true, getValue: (row: BLRow) => row.sales_value, render: (row: BLRow) => <span className="font-medium">{fmt(row.sales_value)}</span> },
    {
      key: 'assigned_subcontractor_id',
      label: 'Tildelt UE',
      sortable: true,
      getValue: (row: BLRow) => row.assigned_name,
      render: (row: BLRow) => row.assigned_subcontractor_id
        ? <span className="text-sm text-gray-900">{row.assigned_name}</span>
        : <span className="text-xs text-orange-400">Ikke tildelt</span>,
    },
    { key: 'cost_value', label: 'Kostnad', sortable: true, getValue: (row: BLRow) => row.cost_value, render: (row: BLRow) => row.assigned_subcontractor_id ? fmt(row.cost_value) : '–' },
    {
      key: 'profit',
      label: 'Fortjeneste',
      sortable: true,
      getValue: (row: BLRow) => row.profit,
      render: (row: BLRow) => row.assigned_subcontractor_id
        ? <span className={row.profit >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{fmt(row.profit)}</span>
        : '–',
    },
  ]

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">
      {/* Missing price dialog */}
      {missingPriceDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full space-y-4 mx-4">
            <h2 className="text-base font-semibold text-gray-900">Manglende priser</h2>
            <p className="text-sm text-gray-600">
              Disse produktene mangler pris hos{' '}
              <strong>{missingPriceDialog.subName}</strong>:
            </p>
            <ul className="text-sm text-gray-700 space-y-1 bg-orange-50 border border-orange-200 rounded p-3">
              {missingPriceDialog.products.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                  {p.name}
                </li>
              ))}
            </ul>
            <p className="text-sm text-gray-600">Vil du gå til prislisten for å legge inn manglende priser?</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setMissingPriceDialog(null)} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
              <button
                onClick={() => {
                  const productIds = missingPriceDialog.products.map((p) => p.id).join(',')
                  sessionStorage.setItem('pending_assignment', JSON.stringify({ projectId: id, selected, bulkSubcontractor }))
                  router.push(`/admin/subcontractors/${missingPriceDialog.subId}/prices?highlight=${productIds}&from_project=${id}`)
                  setMissingPriceDialog(null)
                }}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Ja, gå til prislisten
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin" className="text-gray-400 hover:text-gray-600 text-sm">← Admin</Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{project.name}</h1>
          <p className="text-sm text-gray-500">
            {project.project_number}
            {project.order_number && ` · Ordre: ${project.order_number}`}
            {` · ${project.customer} · ${project.county}`}
          </p>
        </div>
        <Link href={`/admin/projects/${id}/edit`} className="text-sm text-gray-600 border border-gray-200 px-3 py-1 rounded hover:bg-gray-50">Rediger</Link>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-gray-200 -mb-2">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── OVERSIKT ─────────────────────────────────────────────────── */}
      {activeTab === 'oversikt' && (
        <div className="space-y-8">
          {/* Top KPIs */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Prosjektstatistikk</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-blue-600 rounded-xl shadow p-4 text-white">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Salgsverdi</p>
                <p className="text-2xl font-bold mt-1">{fmt(totalSales)}</p>
                <p className="text-xs opacity-70 mt-0.5">inkl. godkjente EM</p>
              </div>
              <div className="bg-white rounded-xl shadow p-4 border border-gray-100">
                <p className="text-xs text-gray-500 uppercase tracking-wide">UE-kostnad</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(totalCost)}</p>
                <p className="text-xs text-gray-400 mt-0.5">tildelte budsjettlinjer</p>
              </div>
              <div className="bg-white rounded-xl shadow p-4 border border-gray-100">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Internkostnad</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(totalInternalCost)}</p>
                <p className="text-xs text-gray-400 mt-0.5">egne timer</p>
              </div>
              <div className={`rounded-xl shadow p-4 border ${(totalSales - totalCost - totalInternalCost) >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Reell fortjeneste</p>
                <p className={`text-2xl font-bold mt-1 ${(totalSales - totalCost - totalInternalCost) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {fmt(totalSales - totalCost - totalInternalCost)}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">salg − UE − intern</p>
              </div>
            </div>

            {/* Budsjettversjoner + Import */}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 bg-white rounded-xl shadow border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Budsjettversjonhistorikk</h3>
                </div>
                {budgetVersions.length === 0 ? (
                  <div className="px-5 py-6 text-sm text-gray-400 text-center">Ingen budsjettfiler lastet opp ennå.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="px-5 py-2.5 text-xs font-medium text-gray-500 uppercase text-left">Versjon</th>
                          <th className="px-5 py-2.5 text-xs font-medium text-gray-500 uppercase text-right">Salgsverdi</th>
                          <th className="px-5 py-2.5 text-xs font-medium text-gray-500 uppercase text-right">Kostnad</th>
                          <th className="px-5 py-2.5 text-xs font-medium text-gray-500 uppercase text-right">Fortjeneste</th>
                          <th className="px-5 py-2.5 text-xs font-medium text-gray-500 uppercase text-right">Endring</th>
                          <th className="px-5 py-2.5 text-xs font-medium text-gray-500 uppercase text-left">Lastet opp</th>
                          <th className="px-5 py-2.5 text-xs font-medium text-gray-500 uppercase text-center">Fil</th>
                        </tr>
                      </thead>
                      <tbody>
                        {budgetVersions.map((bver, idx) => {
                          const prev = idx > 0 ? budgetVersions[idx - 1] : null
                          const delta = prev != null ? bver.total_sales_value - prev.total_sales_value : null
                          const profit = bver.total_sales_value - bver.total_cost_value
                          const isLatest = idx === budgetVersions.length - 1
                          const label = bver.version === 0 ? 'Originalbudsjett' : `V${bver.version}`
                          const dateStr = new Date(bver.uploaded_at).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })
                          const timeStr = new Date(bver.uploaded_at).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
                          return (
                            <tr key={bver.id} className={`border-b border-gray-100 ${isLatest ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                              <td className="px-5 py-3">
                                <span className={`font-medium ${isLatest ? 'text-blue-700' : 'text-gray-900'}`}>{label}</span>
                                {isLatest && <span className="ml-2 text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-medium">Gjeldende</span>}
                              </td>
                              <td className="px-5 py-3 text-right text-gray-700">{fmt(bver.total_sales_value)}</td>
                              <td className="px-5 py-3 text-right text-gray-700">{fmt(bver.total_cost_value)}</td>
                              <td className={`px-5 py-3 text-right font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(profit)}</td>
                              <td className="px-5 py-3 text-right">
                                {delta == null ? (
                                  <span className="text-gray-300">—</span>
                                ) : (
                                  <span className={`font-medium text-xs ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                    {delta > 0 ? '+' : ''}{fmt(delta)}
                                  </span>
                                )}
                              </td>
                              <td className="px-5 py-3">
                                <div className="text-gray-700">{bver.uploaded_by}</div>
                                <div className="text-xs text-gray-400">{dateStr} {timeStr}</div>
                              </td>
                              <td className="px-5 py-3 text-center">
                                {bver.file_name ? (
                                  <a href={`/api/budget-versions/${bver.id}/file`} download title="Last ned Excel-fil" className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-green-100 text-green-600 hover:text-green-700 transition-colors">
                                    <Download size={14} />
                                  </a>
                                ) : (
                                  <span className="text-gray-300 text-xs">–</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Import card */}
              <div
                onClick={() => !importing && importFileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragEnter={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const file = e.dataTransfer.files?.[0]; if (file) handlePostImport(file) }}
                className={`rounded-xl p-6 flex flex-col items-center justify-center text-center gap-4 cursor-pointer transition-colors border-2 border-dashed select-none ${dragOver ? 'bg-blue-100 border-blue-500' : importing ? 'bg-blue-50 border-blue-200 cursor-default' : 'bg-blue-50 border-blue-300 hover:bg-blue-100 hover:border-blue-400'}`}
              >
                <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${dragOver ? 'bg-blue-200' : 'bg-blue-100'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`w-7 h-7 transition-colors ${dragOver ? 'text-blue-700' : 'text-blue-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 12V4m0 0L8 8m4-4l4 4" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-blue-900 text-base">{importing ? 'Importerer...' : dragOver ? 'Slipp filen her' : 'Last inn oppdatert budsjettfil'}</p>
                  <p className="text-sm text-blue-700 mt-1 max-w-xs">{importing ? 'Behandler Excel-filen…' : 'Dra og slipp en .xlsx-fil hit, eller klikk for å velge'}</p>
                </div>
                {!importing && <span className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm pointer-events-none">Velg fil</span>}
                {importMsg && <p className={`text-xs font-medium ${importMsg.toLowerCase().includes('feil') ? 'text-red-600' : 'text-green-600'}`}>{importMsg}</p>}
              </div>
            </div>
          </section>

          {/* Gantt */}
          {project.start_date && project.end_date && (
            <GanttSection
              projectId={id}
              projectStart={project.start_date}
              projectEnd={project.end_date}
              milestones={milestones}
              allSubs={allSubs}
              projectSubs={projectSubs.map((ps) => ps.subcontractor_id)}
              onRefresh={fetchAll}
            />
          )}

          {/* Kostnadsflyt */}
          {(subFlowData.length > 0 || internLines.length > 0) && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Kostnadsflyt</h2>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <p className="text-xs text-blue-700 font-semibold uppercase tracking-wide mb-1">Salgsverdi</p>
                  <p className="text-xl font-bold text-blue-900">{fmt(totalSales)}</p>
                  <p className="text-xs text-blue-500 mt-0.5">inkl. godkjente EM</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <p className="text-xs text-gray-600 font-semibold uppercase tracking-wide mb-1">UE-kostnad</p>
                  <p className="text-xl font-bold text-gray-900">{fmt(totalUEBudgetCost)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Rapportert: {fmt(totalUEReportedCost)}</p>
                </div>
                <div className={`border rounded-xl p-4 ${(totalSales - totalUEBudgetCost - totalInternalCost) >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${(totalSales - totalUEBudgetCost - totalInternalCost) >= 0 ? 'text-green-700' : 'text-red-700'}`}>Forventet fortjeneste</p>
                  <p className={`text-xl font-bold ${(totalSales - totalUEBudgetCost - totalInternalCost) >= 0 ? 'text-green-900' : 'text-red-900'}`}>{fmt(totalSales - totalUEBudgetCost - totalInternalCost)}</p>
                  <p className={`text-xs mt-0.5 ${(totalSales - totalUEBudgetCost - totalInternalCost) >= 0 ? 'text-green-500' : 'text-red-500'}`}>salg − UE − intern</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {internLines.length > 0 && (
                  <div className="bg-white rounded-xl border border-indigo-200 shadow-sm overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-semibold text-gray-900 text-sm">Intern / Netel</span>
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-medium">Intern</span>
                      </div>
                      <div className="mb-2">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>Internkost brukt {internPct}%</span>
                          <span>{fmt(totalInternalCost)} / {fmt(internBudgetSales)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${internPct > 100 ? 'bg-red-500' : internPct > 80 ? 'bg-orange-400' : 'bg-indigo-500'}`} style={{ width: `${Math.min(internPct, 100)}%` }} />
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5 text-xs mt-2">
                        <span className="text-gray-500">Salgsverdi intern: <span className="font-medium text-gray-900">{fmt(internBudgetSales)}</span></span>
                        <span className="text-gray-500">Registrert internkost: <span className="font-medium text-gray-900">{fmt(totalInternalCost)}</span></span>
                        <span className={`font-medium ${internBudgetSales - totalInternalCost >= 0 ? 'text-green-600' : 'text-red-600'}`}>Fortjeneste: {fmt(internBudgetSales - totalInternalCost)}</span>
                      </div>
                    </div>
                  </div>
                )}
                {subFlowData.map((sf) => (
                  <div key={sf.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <button onClick={() => setExpandedSub(expandedSub === sf.id ? null : sf.id)} className="w-full text-left p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-semibold text-gray-900 text-sm">{sf.name}</span>
                        <span className="text-xs text-gray-400">{expandedSub === sf.id ? '▲' : '▼'}</span>
                      </div>
                      <div className="mb-2">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>Rapportert {sf.pct}%</span>
                          <span>{fmt(sf.reportedCost)} / {fmt(sf.budgetCost)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${sf.pct > 90 ? 'bg-red-500' : sf.pct > 70 ? 'bg-orange-400' : 'bg-green-500'}`} style={{ width: `${Math.min(sf.pct, 100)}%` }} />
                        </div>
                      </div>
                      <div className="flex gap-3 text-xs">
                        <span className="text-gray-500">Gjenstår: <span className="font-medium text-gray-900">{fmt(sf.remaining)}</span></span>
                        <span className="text-gray-400">|</span>
                        <span className="text-gray-500">Budsjett: <span className="font-medium text-gray-900">{fmt(sf.budgetCost)}</span></span>
                      </div>
                    </button>
                    {expandedSub === sf.id && (
                      <div className="border-t border-gray-100 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                              <th className="px-3 py-2 text-left font-medium text-gray-500">Produkt</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-500">Budsjett</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-500">Rapportert</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-500">%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sf.products.map((prod) => (
                              <tr key={prod.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                                <td className="px-3 py-2 text-gray-900 max-w-[140px] truncate" title={prod.name}>{prod.name}<span className="text-gray-400 ml-1">({prod.unit})</span></td>
                                <td className="px-3 py-2 text-right text-gray-700">{prod.budgetQty}</td>
                                <td className="px-3 py-2 text-right text-gray-700">{prod.reportedQty}</td>
                                <td className={`px-3 py-2 text-right font-semibold ${prod.pct > 90 ? 'text-red-600' : prod.pct > 70 ? 'text-orange-500' : 'text-green-600'}`}>{prod.pct}%</td>
                              </tr>
                            ))}
                            <tr className="bg-gray-50 border-t border-gray-200">
                              <td className="px-3 py-2 text-xs font-semibold text-gray-600 uppercase">Totalt kostnad</td>
                              <td className="px-3 py-2 text-right font-semibold text-gray-900">{fmt(sf.budgetCost)}</td>
                              <td className="px-3 py-2 text-right font-semibold text-gray-900">{fmt(sf.reportedCost)}</td>
                              <td className={`px-3 py-2 text-right font-bold ${sf.pct > 90 ? 'text-red-600' : sf.pct > 70 ? 'text-orange-500' : 'text-green-600'}`}>{sf.pct}%</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Underentreprenører */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Underentreprenører på prosjektet</h2>
            <div className="bg-white rounded-lg shadow p-5 space-y-4">
              <div className="flex gap-2 items-center">
                <select value={addSubId} onChange={(e) => setAddSubId(e.target.value)} className="text-sm text-gray-900 border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-blue-500">
                  <option value="">Velg underentreprenør</option>
                  {availableSubs.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
                </select>
                <button onClick={addSubToProject} disabled={!addSubId} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-40">Legg til</button>
              </div>
              {projectSubDetails.length > 0 ? (
                <ul className="space-y-2">
                  {projectSubDetails.map((s) => {
                    const link = projectSubs.find((ps) => ps.subcontractor_id === s.id)!
                    return (
                      <li key={s.id} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                        <div>
                          <span className="text-sm font-medium text-gray-900">{s.company_name}</span>
                          <span className="text-xs text-gray-500 ml-2">{s.contact_person} · {s.county}</span>
                        </div>
                        <button onClick={() => setConfirmRemoveSubId(link.id)} className="text-xs text-red-500 hover:text-red-700">Fjern</button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">Ingen UE-er tildelt ennå</p>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ── BUDSJETTLINJER ───────────────────────────────────────────── */}
      {activeTab === 'budsjettlinjer' && (
        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">Budsjettlinjer</h2>
            <div className="flex gap-2 items-center">
              {importMsg && <span className={`text-xs ${importMsg.startsWith('Importerte') ? 'text-green-600' : 'text-red-600'}`}>{importMsg}</span>}
              <button onClick={() => importFileRef.current?.click()} disabled={importing} className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 disabled:opacity-50">
                {importing ? 'Importerer...' : '↑ Importer fra Excel'}
              </button>
              <input ref={importFileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { handlePostImport(f); e.target.value = '' } }} />
              <button onClick={() => setShowAddLine(!showAddLine)} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
                {showAddLine ? 'Avbryt' : '+ Legg til linje'}
              </button>
            </div>
          </div>

          {showAddLine && (
            <form onSubmit={addBudgetLine} className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Produkt</label>
                <select required value={newLine.product_id} onChange={(e) => setNewLine((p) => ({ ...p, product_id: e.target.value }))} className="text-sm text-gray-900 border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-blue-500">
                  <option value="">Velg produkt</option>
                  {allProducts.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.unit}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Mengde</label>
                <NumberInput required value={newLine.budget_quantity} onChange={(raw) => setNewLine((p) => ({ ...p, budget_quantity: raw }))} className="w-28 px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                <select value={newLine.line_type} onChange={(e) => setNewLine((p) => ({ ...p, line_type: e.target.value }))} className="text-sm text-gray-900 border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-blue-500">
                  <option value="subcontractor_work">UE-arbeid</option>
                  <option value="internal_cost">Intern</option>
                  <option value="material">Materiell</option>
                </select>
              </div>
              <button type="submit" disabled={savingLine} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
                {savingLine ? 'Lagrer...' : 'Lagre'}
              </button>
            </form>
          )}

          {bulkError && <div className="px-4 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{bulkError}</div>}

          {/* Filter + bulk assign */}
          <div className="flex flex-wrap items-center gap-3 p-2 bg-gray-50 border border-gray-200 rounded">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4" title="Velg alle" />
            <span className="text-sm text-gray-500">{selected.length > 0 ? `${selected.length} valgt` : 'Velg rader'}</span>
            {selected.length > 0 && (
              <>
                <select value={bulkSubcontractor} onChange={(e) => setBulkSubcontractor(e.target.value)} className="text-sm border border-gray-300 rounded px-2 py-1">
                  <option value="">— Velg underentreprenør —</option>
                  <option value="__intern__">Intern / Netel</option>
                  {projectSubDetails.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
                </select>
                <button onClick={handleBulkAssign} disabled={!bulkSubcontractor} className="text-sm bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-40">Tildel</button>
                <button onClick={() => setSelected([])} className="text-sm text-gray-500 hover:text-gray-700">Avbryt</button>
              </>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-gray-500">Filtrer type:</span>
              <select value={lineTypeFilter} onChange={(e) => setLineTypeFilter(e.target.value)} className="text-sm border border-gray-300 rounded px-2 py-1">
                <option value="all">Alle</option>
                <option value="subcontractor_work">UE-arbeid</option>
                <option value="internal_cost">Intern</option>
                <option value="material">Materiell</option>
              </select>
            </div>
          </div>

          {(() => {
            const allRows = buildBLRows(budgetLines)
            const filteredRows = lineTypeFilter === 'all' ? allRows : allRows.filter((r) => r.line_type === lineTypeFilter)
            return (
              <div className="bg-white rounded-lg shadow">
                <SortableTable
                  columns={blColumns}
                  data={filteredRows}
                  emptyText="Ingen budsjettlinjer ennå"
                  tableClassName="table-fixed"
                  colWidths={['w-8', 'w-24', undefined, 'w-16', 'w-24', 'w-20', 'w-24', 'w-28', 'w-36', 'w-28', 'w-28']}
                  rowClassName={(row: BLRow) => row.assigned_subcontractor_id ? 'border-b border-gray-100 hover:bg-blue-50' : 'border-b border-orange-100 bg-orange-50 hover:bg-orange-100'}
                  expandedRowId={chartLineId}
                  onRowExpand={(rowId) => setChartLineId(rowId)}
                  expandedRowRender={expandedRowRenderFn}
                />
              </div>
            )
          })()}
        </section>
      )}

      {/* ── PROGNOSE ─────────────────────────────────────────────────── */}
      {activeTab === 'prognose' && (
        <div className="space-y-6">
          {hasForecast && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Prognose — månedlig plan</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl shadow-sm p-4">
                  <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">Forventet inntekt</p>
                  <p className="text-2xl font-bold text-indigo-900 mt-1">{fmt(forecastRevenue)}</p>
                  {forecastRevenue > 0 && totalSales > 0 && (
                    <p className={`text-xs mt-0.5 font-medium ${forecastRevenue <= totalSales ? 'text-amber-600' : 'text-red-500'}`}>
                      {forecastRevenue < totalSales ? `−${fmt(totalSales - forecastRevenue)} vs. kontrakt` : `+${fmt(forecastRevenue - totalSales)} vs. kontrakt`}
                    </p>
                  )}
                </div>
                <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Forventet UE-kost</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(forecastUECost)}</p>
                </div>
                <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Forventet internkost</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(forecastInternalCost)}</p>
                  {forecastOtherCost > 0 && <p className="text-xs text-gray-400 mt-0.5">+ {fmt(forecastOtherCost)} andre kost.</p>}
                </div>
                <div className={`rounded-xl shadow-sm p-4 border ${forecastProfit >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Forventet fortjeneste</p>
                  <p className={`text-2xl font-bold mt-1 ${forecastProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(forecastProfit)}</p>
                </div>
              </div>
            </section>
          )}

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Prognoseside</h3>
              <p className="text-sm text-gray-500 mt-1">Legg inn månedlige prognose-tall, forventet inntekt og kostnader per periode.</p>
            </div>
            <Link
              href={`/admin/projects/${id}/forecast`}
              className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Åpne prognose →
            </Link>
          </div>
        </div>
      )}

      {/* ── INTERNE KOSTNADER ────────────────────────────────────────── */}
      {activeTab === 'interne' && (
        <InternalCostsSection
          projectId={id}
          internalCosts={internalCosts}
          totalInternalCost={totalInternalCost}
          onAdded={fetchAll}
          onRequestDelete={setConfirmDeleteCostId}
        />
      )}

      {/* ── MATERIELL ────────────────────────────────────────────────── */}
      {activeTab === 'materiell' && (
        <MaterialSection
          rows={buildBLRows(budgetLines.filter((bl) => bl.line_type === 'material'))}
          columns={blColumns.filter((c) => c.key !== 'select' && c.key !== 'line_type')}
          expandedRowId={chartLineId}
          onRowExpand={(rowId) => setChartLineId(rowId)}
          expandedRowRender={expandedRowRenderFn}
          onGoToBudgetLines={() => setActiveTab('budsjettlinjer')}
        />
      )}

      {/* ── RAPPORTERINGER ───────────────────────────────────────────── */}
      {activeTab === 'rapporteringer' && (
        <ReportingsSection
          reportLines={reportLines}
          budgetLines={budgetLines}
          allProducts={allProducts}
          allSubs={allSubs}
          onUpdateStatus={updateReportStatus}
        />
      )}

      {/* ── ENDRINGSMELDINGER ────────────────────────────────────────── */}
      {activeTab === 'endringsmeldinger' && (
        <ChangeOrdersSection
          changeOrders={changeOrders}
          allProducts={allProducts}
          allSubs={allSubs}
          onStatusChange={updateCOStatus}
        />
      )}

      {/* ── FAKTURAGRUNNLAG ──────────────────────────────────────────── */}
      {activeTab === 'fakturagrunnlag' && (
        <InvoicesSection projectId={id} />
      )}

      {confirmRemoveSubId && (
        <ConfirmDialog
          title="Fjern UE fra prosjektet?"
          message="UE-en fjernes fra prosjektet. Budsjettlinjer og rapporter beholdes."
          confirmLabel="Fjern"
          onConfirm={() => { removeSubFromProject(confirmRemoveSubId); setConfirmRemoveSubId(null) }}
          onCancel={() => setConfirmRemoveSubId(null)}
        />
      )}

      {confirmDeleteCostId && (
        <ConfirmDialog
          title="Slett intern kostnad?"
          message="Intern kostnadspost slettes permanent."
          onConfirm={() => { deleteInternalCost(confirmDeleteCostId); setConfirmDeleteCostId(null) }}
          onCancel={() => setConfirmDeleteCostId(null)}
        />
      )}
    </main>
  )
}
