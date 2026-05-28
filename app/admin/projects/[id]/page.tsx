'use client'

import { useEffect, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useProjectData } from './useProjectData'
import type { Product } from '@/types'
import ConfirmDialog from '@/components/ConfirmDialog'

// Tab content lazy-loaded — most users land on the default tab and don't
// touch Gantt/Invoices/Change orders right away. Defers ~30-60 KB of JS.
const InvoicesSection = dynamic(() => import('./InvoicesSection'), { ssr: false })
const ChangeOrdersSection = dynamic(() => import('./ChangeOrdersSection'), { ssr: false })
import ReportingsSection from './ReportingsSection'
import InternalCostsSection from './InternalCostsSection'
import MaterialSection from './MaterialSection'
import ForecastSection from './ForecastSection'
import OverviewSection from './OverviewSection'
import BudgetLinesSection from './BudgetLinesSection'
import FremdriftsplanSection from './FremdriftsplanSection'
import KostSection from './KostSection'
import ProjectStatusHero from './ProjectStatusHero'
import ChecklistSection from './ChecklistSection'

const TABS = [
  { id: 'oversikt', label: 'Oversikt' },
  { id: 'budsjett', label: 'Budsjett' },
  { id: 'sjekkliste', label: 'Sjekkliste' },
  { id: 'fremdriftsplan', label: 'Fremdriftsplan' },
  { id: 'kost', label: 'Kost' },
  { id: 'prognose', label: 'Prognose' },
  { id: 'interne', label: 'Interne kostnader' },
  { id: 'materiell', label: 'Materiell' },
  { id: 'rapporteringer', label: 'Rapporteringer' },
  { id: 'endringsmeldinger', label: 'Endringsmeldinger' },
  { id: 'fakturagrunnlag', label: 'Fakturagrunnlag' },
] as const
type ActiveTab = (typeof TABS)[number]['id']

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  // All data + mutation handlers live in the hook. Page-local UI state
  // (tabs, dialog open/close, draft form values) stays here.
  const {
    project, allProducts, budgetLines, reportLines, projectSubs, allSubs,
    changeOrders, internalCosts, weeklyReportsWL, subPrices, milestones,
    budgetVersions, monthPlans, projectManagers, loading, adminName,
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

  // toggleRow used by BudgetLinesSection's row-checkbox; selected state stays
  // in parent so it survives across activeTab switches.
  const toggleRow = (rowId: string) => setSelected((prev) => prev.includes(rowId) ? prev.filter((x) => x !== rowId) : [...prev, rowId])

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
        {/* Lukk / Åpne — flips project.status between 'active' and 'completed'.
            Completed projects fall into 'Avsluttede' on /admin/projects and
            reject new reports/EMs server-side. Re-opening reverses both. */}
        <button
          type="button"
          onClick={async () => {
            const closing = project.status === 'active'
            const next = closing ? 'completed' : 'active'
            const confirmMsg = closing
              ? 'Lukk prosjektet? UE-er kan ikke sende nye ukesrapporter eller endringsmeldinger på det. Du kan åpne det igjen når som helst.'
              : 'Åpne prosjektet på nytt? UE-er får tilbake muligheten til å sende rapporter og EMer.'
            if (!confirm(confirmMsg)) return
            const res = await fetch(`/api/projects/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...project, status: next }),
            })
            if (!res.ok) {
              const d = await res.json().catch(() => ({}))
              alert(d.error ?? 'Kunne ikke endre status')
              return
            }
            fetchAll()
          }}
          className={`text-sm px-3 py-1 rounded border transition-colors ${
            project.status === 'active'
              ? 'text-amber-700 border-amber-200 hover:bg-amber-50'
              : 'text-green-700 border-green-200 hover:bg-green-50'
          }`}
        >
          {project.status === 'active' ? 'Lukk prosjekt' : 'Åpne på nytt'}
        </button>
        <Link href={`/admin/projects/${id}/edit`} className="text-sm text-gray-600 border border-gray-200 px-3 py-1 rounded hover:bg-gray-50">Rediger</Link>
      </div>

      {/* Status hero — always visible. Click-through targets pop the right
          detail tab so the user lands on the EM / report queue they came for. */}
      <ProjectStatusHero
        project={project}
        budgetLines={budgetLines}
        weeklyReportsWL={weeklyReportsWL}
        changeOrders={changeOrders}
        projectManagers={projectManagers}
        onGoToTab={(tab) => setActiveTab(tab)}
      />

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
      {/* ── BUDSJETT ─────────────────────────────────────────────────── */}
      {activeTab === 'budsjett' && (
        <BudgetLinesSection
          project={project}
          budgetLines={budgetLines}
          allProducts={allProducts}
          allSubs={allSubs}
          projectSubDetails={projectSubDetails}
          changeOrders={changeOrders}
          showAddLine={showAddLine}
          setShowAddLine={setShowAddLine}
          newLine={newLine}
          setNewLine={setNewLine}
          savingLine={savingLine}
          onAddBudgetLine={addBudgetLine}
          selected={selected}
          setSelected={setSelected}
          bulkSubcontractor={bulkSubcontractor}
          setBulkSubcontractor={setBulkSubcontractor}
          bulkError={bulkError}
          onBulkAssign={handleBulkAssign}
          allChecked={allChecked}
          onToggleAll={toggleAll}
          onToggleRow={toggleRow}
          lineTypeFilter={lineTypeFilter}
          setLineTypeFilter={setLineTypeFilter}
          chartLineId={chartLineId}
          setChartLineId={setChartLineId}
          importFileRef={importFileRef}
          importing={importing}
          importMsg={importMsg}
          onImport={handlePostImport}
          // Budsjettversjonhistorikk + Excel-import has moved here from Oversikt
          budgetVersions={budgetVersions}
          dragOver={dragOver}
          setDragOver={setDragOver}
        />
      )}

      {/* ── SJEKKLISTE ───────────────────────────────────────────────── */}
      {activeTab === 'sjekkliste' && (
        <ChecklistSection
          projectId={id}
          projectTypeId={project.project_type_id ?? null}
        />
      )}

      {/* ── FREMDRIFTSPLAN ───────────────────────────────────────────── */}
      {activeTab === 'fremdriftsplan' && project.start_date && project.end_date && (
        <FremdriftsplanSection
          projectId={id}
          projectStart={project.start_date}
          projectEnd={project.end_date}
          milestones={milestones}
          allSubs={allSubs}
          projectSubIds={projectSubs.map((ps) => ps.subcontractor_id)}
          monthPlans={monthPlans}
          onRefresh={fetchAll}
        />
      )}
      {activeTab === 'fremdriftsplan' && (!project.start_date || !project.end_date) && (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-[var(--color-text-muted)]">
          Sett start- og sluttdato på prosjektet for å aktivere fremdriftsplanen.
        </div>
      )}

      {/* ── KOST ─────────────────────────────────────────────────────── */}
      {activeTab === 'kost' && (
        <KostSection
          totalSales={totalSales}
          totalCost={totalCost}
          totalInternalCost={totalInternalCost}
        />
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
          project={project}
          budgetLines={budgetLines}
          allProducts={allProducts}
          allSubs={allSubs}
          changeOrders={changeOrders}
          chartLineId={chartLineId}
          setChartLineId={setChartLineId}
          onGoToBudgetLines={() => setActiveTab('budsjett')}
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
