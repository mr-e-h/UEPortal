'use client'

import { useEffect, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useProjectData } from './useProjectData'
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
import ForecastSection from './ForecastSection'
import OverviewSection from './OverviewSection'
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

  // All data + mutation handlers live in the hook. Page-local UI state
  // (tabs, dialog open/close, draft form values) stays here.
  const {
    project, allProducts, budgetLines, reportLines, projectSubs, allSubs,
    changeOrders, internalCosts, weeklyReportsWL, subPrices, milestones,
    budgetVersions, monthPlans, loading, adminName,
    fetchAll, addBudgetLine: addBudgetLineHandler, addSubToProject: addSubHandler,
    removeSubFromProject, updateReportStatus, updateChangeOrderStatus: updateCOStatus,
    deleteInternalCost,
  } = useProjectData(id)

  const [activeTab, setActiveTab] = useState<ActiveTab>('oversikt')

  const [showAddLine, setShowAddLine] = useState(false)
  const [newLine, setNewLine] = useState({ product_id: '', budget_quantity: '', line_type: 'subcontractor_work' })
  const [savingLine, setSavingLine] = useState(false)

  const [selected, setSelected] = useState<string[]>([])
  const [bulkSubcontractor, setBulkSubcontractor] = useState('')
  const [bulkError, setBulkError] = useState('')
  const [missingPriceDialog, setMissingPriceDialog] = useState<{ subId: string; subName: string; products: Product[] } | null>(null)

  const [addSubId, setAddSubId] = useState('')

  const [confirmRemoveSubId, setConfirmRemoveSubId] = useState<string | null>(null)
  const [confirmDeleteCostId, setConfirmDeleteCostId] = useState<string | null>(null)
  const [chartLineId, setChartLineId] = useState<string | null>(null)

  // Line type filter for Budsjettlinjer tab
  const [lineTypeFilter, setLineTypeFilter] = useState<string>('all')

  const [expandedSub, setExpandedSub] = useState<string | null>(null)

  // Excel post-import
  const importFileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState('')
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // Restore pending assignment if coming back from the prices page (UI-only).
  useEffect(() => {
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
  }, [id])

  async function addBudgetLine(e: React.FormEvent) {
    e.preventDefault()
    setSavingLine(true)
    await addBudgetLineHandler({
      product_id: newLine.product_id,
      budget_quantity: Number(newLine.budget_quantity),
      line_type: newLine.line_type,
    })
    setNewLine({ product_id: '', budget_quantity: '', line_type: 'subcontractor_work' })
    setShowAddLine(false)
    setSavingLine(false)
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

    // Per-line: run all PUTs in parallel, collect each line's outcome so
    // we can show admin exactly which rows failed and why instead of a
    // generic "noen feilet". Successful lines drop out of `selected`, the
    // failures stick around for retry.
    const settled = await Promise.allSettled(
      selected.map(async (lineId) => {
        let res: Response
        try {
          res = await fetch('/api/budget-lines', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: lineId, assigned_subcontractor_id: bulkSubcontractor }),
          })
        } catch {
          throw { lineId, error: 'Nettverksfeil' }
        }
        if (!res.ok) {
          const d = await res.json().catch(() => ({} as { error?: string }))
          throw { lineId, error: d.error ?? `HTTP ${res.status}` }
        }
        return lineId
      })
    )

    const successIds = new Set<string>()
    const failures: { lineId: string; error: string }[] = []
    for (const r of settled) {
      if (r.status === 'fulfilled') successIds.add(r.value)
      else failures.push(r.reason as { lineId: string; error: string })
    }

    if (failures.length > 0) {
      const productNames = failures.map((f) => {
        const bl = budgetLines.find((b) => b.id === f.lineId)
        const p = bl ? allProducts.find((pp) => pp.id === bl.product_id) : null
        return `${p?.name ?? bl?.product_id ?? f.lineId}: ${f.error}`
      })
      setBulkError(`${failures.length} av ${selected.length} feilet — ${productNames.slice(0, 3).join(' · ')}${productNames.length > 3 ? ` …` : ''}`)
    }

    // Drop successful lines from the selection. Failures stay selected so
    // the admin can fix the underlying problem (usually missing price) and
    // retry on the same rows.
    setSelected((prev) => prev.filter((id) => !successIds.has(id)))
    if (failures.length === 0) setBulkSubcontractor('')
    fetchAll()
  }

  async function addSubToProject() {
    if (!addSubId) return
    await addSubHandler(addSubId)
    setAddSubId('')
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

  // OverviewSection owns the heavy derived computations now (subFlowData,
  // internLines, totalUEBudgetCost, etc). Parent only keeps what the
  // remaining inline tabs (budsjettlinjer + prognose-card) still consume.
  const assignedSubIds = new Set(projectSubs.map((ps) => ps.subcontractor_id))
  const projectSubDetails = allSubs.filter((s) => assignedSubIds.has(s.id))

  const totalInternalCost = internalCosts.reduce((s, c) => s + c.amount, 0)

  // "Select all" must match the visible filter — selecting hidden rows is
  // confusing and the count "X valgt" would be wrong. Filter the same way
  // the rendered table does (line_type filter).
  const visibleBudgetLines = lineTypeFilter === 'all'
    ? budgetLines
    : budgetLines.filter((bl) => (bl.line_type ?? 'subcontractor_work') === lineTypeFilter)
  const visibleIds = visibleBudgetLines.map((l) => l.id)
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))
  const toggleAll = () => setSelected(allChecked ? [] : visibleIds)

  // Prognose totals from monthly plan entries (passed to ForecastSection).
  const forecastRevenue = monthPlans.reduce((s, m) => s + (m.expected_revenue ?? 0), 0)
  const forecastUECost = monthPlans.reduce((s, m) => s + (m.ue_cost ?? 0), 0)
  const forecastInternalCost = monthPlans.reduce((s, m) => s + (m.internal_cost ?? 0), 0)
  const forecastOtherCost = monthPlans.reduce((s, m) => s + (m.other_cost ?? 0), 0)
  const forecastProfit = forecastRevenue - forecastUECost - forecastInternalCost - forecastOtherCost
  const hasForecast = forecastRevenue > 0 || forecastUECost > 0 || forecastInternalCost > 0

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
        <OverviewSection
          projectId={id}
          project={project}
          budgetLines={budgetLines}
          changeOrders={changeOrders}
          internalCosts={internalCosts}
          budgetVersions={budgetVersions}
          milestones={milestones}
          allProducts={allProducts}
          allSubs={allSubs}
          projectSubs={projectSubs}
          weeklyReportsWL={weeklyReportsWL}
          fetchAll={fetchAll}
          addSubId={addSubId}
          setAddSubId={setAddSubId}
          onAddSub={addSubToProject}
          onRequestRemoveSub={setConfirmRemoveSubId}
          importFileRef={importFileRef}
          importing={importing}
          importMsg={importMsg}
          dragOver={dragOver}
          setDragOver={setDragOver}
          onImport={handlePostImport}
        />
      )}
      {/* ── BUDSJETTLINJER ───────────────────────────────────────────── */}
      {activeTab === 'budsjettlinjer' && (
        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">Budsjettlinjer</h2>
            <div className="flex gap-2 items-center">
              {/* handlePostImport builds messages like "3 nye linjer · 1 oppdatert" on success,
                  or "<error>"/"Import feilet" on failure — pick color by "feil" substring. */}
              {importMsg && <span className={`text-xs ${importMsg.toLowerCase().includes('feil') ? 'text-red-600' : 'text-green-600'}`}>{importMsg}</span>}
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
        <ForecastSection
          projectId={id}
          totalSales={totalSales}
          forecastRevenue={forecastRevenue}
          forecastUECost={forecastUECost}
          forecastInternalCost={forecastInternalCost}
          forecastOtherCost={forecastOtherCost}
          forecastProfit={forecastProfit}
          hasForecast={hasForecast}
        />
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
