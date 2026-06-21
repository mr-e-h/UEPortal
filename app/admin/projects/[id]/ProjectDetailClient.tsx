'use client'

import { useEffect, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useProjectData } from './useProjectData'
import { useMe } from '@/lib/useMe'
import type { Product } from '@/types'
import { fmtProductLabel } from '@/lib/format'
import { internalCostTotal, fallbackEndMonthIndex, planEndDate } from '@/lib/internal-costs'
import ConfirmDialog from '@/components/ConfirmDialog'
import ErrorBox from '@/components/ui/ErrorBox'
import { useConfirm } from '@/components/ui/useConfirm'
import type { ProjectDetailData } from '@/lib/admin-project-detail'

// Tab content lazy-loaded — most users land on the default tab and don't
// touch Gantt/Invoices/Change orders right away. Defers ~30-60 KB of JS.
const InvoicesSection = dynamic(() => import('./InvoicesSection'), { ssr: false })
const ChangeOrdersSection = dynamic(() => import('./ChangeOrdersSection'), { ssr: false })
import ReportingsSection from './ReportingsSection'
import InternalCostsSection from './InternalCostsSection'
import SubcontractorsSection from './SubcontractorsSection'
import MaterialSection from './MaterialSection'
import ForecastSection from './ForecastSection'
import OverviewSection from './OverviewSection'
import BudgetLinesSection from './BudgetLinesSection'
import FremdriftsplanSection from './FremdriftsplanSection'
import ProjectStatusHero from './ProjectStatusHero'
import ChecklistSection from './ChecklistSection'
import ReconciliationSection from './ReconciliationSection'

const TABS = [
  { id: 'oversikt', label: 'Oversikt' },
  { id: 'budsjett', label: 'Budsjett' },
  { id: 'underentreprenorer', label: 'Underentreprenører' },
  { id: 'sjekkliste', label: 'Sjekkliste' },
  { id: 'fremdriftsplan', label: 'Fremdriftsplan' },
  { id: 'prognose', label: 'Prognose' },
  { id: 'interne', label: 'Interne kostnader' },
  { id: 'materiell', label: 'Materiell' },
  { id: 'rapporteringer', label: 'Rapporteringer' },
  { id: 'endringsmeldinger', label: 'Endringsmeldinger' },
  { id: 'fakturagrunnlag', label: 'Fakturagrunnlag' },
  { id: 'avstemming', label: 'Avstemming' },
] as const
type ActiveTab = (typeof TABS)[number]['id']

// Byggeleder (site manager): operational tabs only — no budget/economy/
// forecast/invoice surfaces. UI-filtering is UX; the underlying economy APIs
// (budget-lines, invoices, forecasts, internal costs) 403/mask server-side.
const SITE_MANAGER_TABS: ReadonlyArray<ActiveTab> = ['sjekkliste', 'fremdriftsplan', 'rapporteringer', 'endringsmeldinger']

interface Props {
  /** Server-fetched initial data. Seeds state immediately — no blank-screen
   *  waterfall. fetchAll() in useProjectData still runs after mutations. */
  initialData: ProjectDetailData
}

export default function ProjectDetailClient({ initialData }: Props) {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  // All data + mutation handlers live in the hook. Page-local UI state
  // (tabs, dialog open/close, draft form values) stays here.
  // Pass initialData so the hook seeds state from SSR — no spinner on mount.
  const {
    project, allProducts, budgetLines, reportLines, projectSubs, allSubs,
    changeOrders, internalCosts, weeklyReportsWL, subPrices, milestones, phases, phaseTypes,
    budgetVersions, monthPlans, projectManagers, invoices, productionEntries, reconciliationLines,
    productionVersions, materials, materialVersions,
    loading, adminName,
    fetchAll, addBudgetLine: addBudgetLineHandler, addSubToProject: addSubHandler,
    removeSubFromProject, updateReportStatus, updateChangeOrderStatus: updateCOStatus,
    deleteInternalCost, addProductionEntry, saveProductionBatch, saveReconciliationLine,
    setReconciliationStatus, saveMaterialReconciliation,
  } = useProjectData(id, initialData)

  const { me } = useMe()
  const isSiteManager = me?.role === 'byggeleder'
  const visibleTabs = isSiteManager ? TABS.filter((t) => SITE_MANAGER_TABS.includes(t.id)) : TABS

  const [activeTab, setActiveTab] = useState<ActiveTab>('oversikt')

  // Byggeleder lander på Rapporteringer (Oversikt er økonomi-tung og skjult).
  // Kjøres når rollen er kjent + hvis aktiv fane ikke er tillatt.
  useEffect(() => {
    if (isSiteManager && !SITE_MANAGER_TABS.includes(activeTab)) {
      setActiveTab('rapporteringer')
    }
  }, [isSiteManager, activeTab])

  const [showAddLine, setShowAddLine] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const { confirm: confirmAction, confirmDialog } = useConfirm()
  const [newLine, setNewLine] = useState({ product_id: '', budget_quantity: '', line_type: 'subcontractor_work' })
  const [savingLine, setSavingLine] = useState(false)

  const [selected, setSelected] = useState<string[]>([])
  const [bulkSubcontractor, setBulkSubcontractor] = useState('')
  const [bulkError, setBulkError] = useState('')
  const [missingPriceDialog, setMissingPriceDialog] = useState<{ subId: string; subName: string; products: Product[] } | null>(null)

  const [confirmRemoveSubId, setConfirmRemoveSubId] = useState<string | null>(null)
  const [confirmDeleteCostId, setConfirmDeleteCostId] = useState<string | null>(null)
  const [chartLineId, setChartLineId] = useState<string | null>(null)

  // Line type filter for Budsjettlinjer tab
  const [lineTypeFilter, setLineTypeFilter] = useState<string>('all')

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
        const label = p ? fmtProductLabel(p) : (bl?.product_id ?? f.lineId)
        return `${label}: ${f.error}`
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

  // Tagg en budsjettlinje til en fase (eller fjern taggen). Gir avledet
  // fasevekt i prognosen — se ØKONOMIMODELL.md punkt 1b.
  async function handleAssignPhase(lineId: string, phaseId: string | null) {
    await fetch('/api/budget-lines', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lineId, phase_id: phaseId }),
    }).catch(() => {})
    fetchAll()
  }

  async function addSubToProject(subId: string) {
    if (!subId) return
    await addSubHandler(subId)
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

  // While initial data is loading (should never happen with SSR seed, but
  // guards the rare case where initialData arrives empty after a mutation
  // refresh races the page mount).
  if (loading && !project) return <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Laster...</div>
  if (!project) return <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Prosjekt ikke funnet</div>

  const manualLines = budgetLines.filter((bl) => !bl.source || bl.source === 'manual')

  const originalBudgetSales = manualLines.reduce((s, bl) => s + bl.budget_quantity * bl.customer_price_snapshot, 0)

  const approvedCOs = changeOrders.filter((co) => co.status === 'approved')
  const coAddedSales = approvedCOs.reduce((s, co) => s + co.total_customer_value, 0)

  // Salgsverdi (ordrebok + godkjente EM) — brukes av Prognose-fanen. Hele
  // kost/fortjeneste-bildet bor i hero-ens Lønnsomhet (egen Kost-fane fjernet).
  const totalSales = originalBudgetSales + coAddedSales

  // OverviewSection owns the heavy derived computations now (subFlowData,
  // internLines, totalUEBudgetCost, etc). Parent only keeps what the
  // remaining inline tabs (budsjettlinjer + prognose-card) still consume.
  const assignedSubIds = new Set(projectSubs.map((ps) => ps.subcontractor_id))
  const projectSubDetails = allSubs.filter((s) => assignedSubIds.has(s.id))

  // Periodens slutt for løpende interne kostnader følger FREMDRIFTSPLANEN
  // (seneste fase/milepæl), ikke prosjektets statiske sluttdato — så f.eks.
  // riggplass regnes over varigheten man faktisk planlegger, og oppdateres når
  // fremdriftsplanen endres. Tom plan → fall tilbake til prosjektets sluttdato.
  const planEnd = planEndDate(phases, milestones, project.end_date)
  // Engangs + løpende månedlige interne kostnader, utvidet over periodene.
  const totalInternalCost = internalCostTotal(internalCosts, fallbackEndMonthIndex(planEnd, new Date()))

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

  // ── Lukk-gating (avstemming) ──────────────────────────────────────────────
  // Serveren håndhever lukk-gaten uansett (409 hvis reconciliation_status ∉
  // {reconciled, closed}); her gir vi forhåndsvarsel slik at admin ikke trenger
  // å trykke «Lukk» for å oppdage problemet.
  const reconStatus = project.reconciliation_status ?? 'not_started'
  const reconReady = reconStatus === 'reconciled' || reconStatus === 'closed'

  // Ubehandlede differanser: budsjettlinjer der totalt utført ≠ planlagt og
  // avstemmingslinja ikke er huket «behandlet». Samme aggregering som
  // ReconciliationSection (godkjente WR-linjer + produksjonsføringer).
  const unresolvedReconDiffs = (() => {
    const approvedWRLines = weeklyReportsWL
      .filter((wr) => wr.status === 'approved' || wr.status === 'partially_approved')
      .flatMap((wr) => wr.lines.filter((l) => l.status === 'approved'))
    const ueQtyByLine = new Map<string, number>()
    for (const l of approvedWRLines) {
      ueQtyByLine.set(l.project_budget_line_id, (ueQtyByLine.get(l.project_budget_line_id) ?? 0) + l.reported_quantity)
    }
    // Samme uten-kost-definisjon som ReconciliationSection: KUN egenprod/intern
    // (executed_by ∈ internal/other), så lukk-gatens diff-telling matcher tabellen.
    const noCostQtyByLine = new Map<string, number>()
    for (const e of productionEntries) {
      if (!e.project_budget_line_id) continue
      if (e.executed_by !== 'internal' && e.executed_by !== 'other') continue
      noCostQtyByLine.set(e.project_budget_line_id, (noCostQtyByLine.get(e.project_budget_line_id) ?? 0) + e.quantity)
    }
    const reconByLineId = new Map(reconciliationLines.map((r) => [r.project_budget_line_id, r]))
    return budgetLines.filter((bl) => {
      const totalExecuted = (ueQtyByLine.get(bl.id) ?? 0) + (noCostQtyByLine.get(bl.id) ?? 0)
      const diff = totalExecuted - bl.budget_quantity
      if (Math.abs(diff) <= 1e-9) return false
      return !(reconByLineId.get(bl.id)?.handled ?? false)
    }).length
  })()

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">
      {confirmDialog}
      {statusError && <ErrorBox>{statusError}</ErrorBox>}
      {/* Missing price dialog */}
      {missingPriceDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full space-y-4 mx-4">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Manglende priser</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Disse produktene mangler pris hos{' '}
              <strong>{missingPriceDialog.subName}</strong>:
            </p>
            <ul className="text-sm text-[var(--color-text-secondary)] space-y-1 bg-orange-50 border border-orange-200 rounded p-3">
              {missingPriceDialog.products.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                  {fmtProductLabel(p)}
                </li>
              ))}
            </ul>
            <p className="text-sm text-[var(--color-text-secondary)]">Vil du gå til prislisten for å legge inn manglende priser?</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setMissingPriceDialog(null)} className="px-3 py-1.5 text-sm text-[var(--color-text-secondary)] border border-border rounded hover:bg-muted">Avbryt</button>
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
        <Link href="/admin" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-sm">← Admin</Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{project.name}</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {project.project_number}
            {project.order_number && ` · Ordre: ${project.order_number}`}
            {` · ${project.customer} · ${project.county}`}
          </p>
        </div>
        {/* Lukk / Åpne — flips project.status between 'active' and 'completed'.
            Completed projects fall into 'Avsluttede' on /admin/projects and
            reject new reports/EMs server-side. Re-opening reverses both.
            Admin-handlinger — skjult for byggeleder (API-ene 403'er uansett). */}
        {!isSiteManager && (
        <button
          type="button"
          onClick={async () => {
            const closing = project.status === 'active'
            const next = closing ? 'completed' : 'active'
            // Lukk-gating: SERVEREN er sannheten — den 409'er hvis avstemmingen ikke
            // er ferdig (reconciliation_status ∉ {reconciled, closed}). Her gir vi
            // bare forhåndsvarsel; statusen settes via Avstemming-fanens arbeidsflyt,
            // så vi sender admin dit i stedet for å la serveren avvise i blinde.
            if (closing && !reconReady) {
              setStatusError('Prosjektet kan ikke lukkes før avstemmingen er markert «Avstemt». Gå til Avstemming-fanen.')
              setActiveTab('avstemming')
              return
            }
            // Ubehandlede differanser er IKKE en server-gate — det er en kvalitets-
            // advarsel. Vis en (rød) bekreftelse admin kan overstyre, så lukking
            // aldri blokkeres permanent når statusen først er «Avstemt».
            if (closing && unresolvedReconDiffs > 0) {
              const proceed = await confirmAction({
                title: 'Lukke med ubehandlede differanser?',
                message: `Avstemmingen har ${unresolvedReconDiffs} ubehandlet${unresolvedReconDiffs === 1 ? '' : 'e'} differanse${unresolvedReconDiffs === 1 ? '' : 'r'} (utført ≠ planlagt, ikke merket behandlet). Du kan lukke likevel, men bør helst kommentere dem i Avstemming-fanen først.`,
                confirmLabel: 'Lukk likevel',
              })
              if (!proceed) { setActiveTab('avstemming'); return }
            }
            const ok = await confirmAction(closing
              ? { title: 'Lukk prosjektet?', message: 'UE-er kan ikke sende nye ukesrapporter eller endringsmeldinger på det. Du kan åpne det igjen når som helst.', confirmLabel: 'Lukk prosjekt' }
              : { title: 'Åpne prosjektet på nytt?', message: 'UE-er får tilbake muligheten til å sende rapporter og EMer.', confirmLabel: 'Åpne på nytt' })
            if (!ok) return
            // Send KUN status — serveren utleder avstemmingsstatus (→ 'closed' ved
            // lukking, → 'reconciled' ved gjenåpning). Å sende hele prosjektet ville
            // tatt med dagens reconciliation_status og dermed slått av den utledningen.
            const res = await fetch(`/api/projects/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: next }),
            })
            if (!res.ok) {
              const d = await res.json().catch(() => ({}))
              setStatusError(d.error ?? 'Kunne ikke endre status')
              return
            }
            setStatusError(null)
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
        )}
        {!isSiteManager && (
          <Link href={`/admin/projects/${id}/edit`} className="text-sm text-[var(--color-text-secondary)] border border-border px-3 py-1 rounded hover:bg-muted">Rediger</Link>
        )}
      </div>

      {/* Status hero — economy summary (salgsverdi/fakturert), so it's
          hidden for byggeleder. Click-through targets pop the right detail
          tab so the user lands on the EM / report queue they came for. */}
      {!isSiteManager && (
        <ProjectStatusHero
          project={project}
          budgetLines={budgetLines}
          weeklyReportsWL={weeklyReportsWL}
          changeOrders={changeOrders}
          internalCosts={internalCosts}
          productionEntries={productionEntries}
          invoices={invoices}
          periodEnd={planEnd}
          projectManagers={projectManagers}
          materials={materials}
          onGoToTab={(tab) => setActiveTab(tab)}
        />
      )}

      {/* Tab navigation */}
      <div className="border-b border-border -mb-2">
        <nav className="flex gap-1 overflow-x-auto">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:border-border'
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
          projectStart={project.start_date}
          projectEnd={project.end_date}
          plannedHoursOverride={project.planned_hours}
          orderValue={totalSales}
          onOpenFremdriftsplan={() => setActiveTab('fremdriftsplan')}
          onOpenInternalCosts={() => setActiveTab('interne')}
          onOpenInvoices={() => setActiveTab('fakturagrunnlag')}
          invoices={invoices}
          milestones={milestones}
          budgetLines={budgetLines}
          internalCosts={internalCosts}
          totalInternalCost={totalInternalCost}
          allProducts={allProducts}
          allSubs={allSubs}
          projectSubs={projectSubs}
          weeklyReportsWL={weeklyReportsWL}
          productionEntries={productionEntries}
          onAddSub={addSubToProject}
          onRequestRemoveSub={setConfirmRemoveSubId}
          onProjectUpdated={fetchAll}
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
          phases={phases}
          phaseTypes={phaseTypes}
          onAssignPhase={handleAssignPhase}
          showAddLine={showAddLine}
          setShowAddLine={setShowAddLine}
          newLine={newLine}
          setNewLine={setNewLine}
          savingLine={savingLine}
          onAddBudgetLine={addBudgetLine}
          onRefresh={fetchAll}
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

      {/* ── UNDERENTREPRENØRER ───────────────────────────────────────── */}
      {activeTab === 'underentreprenorer' && (
        <SubcontractorsSection
          budgetLines={budgetLines}
          projectSubs={projectSubs}
          allSubs={allSubs}
          allProducts={allProducts}
          weeklyReportsWL={weeklyReportsWL}
          phases={phases}
          phaseTypes={phaseTypes}
          productionEntries={productionEntries}
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
          projectName={project.name}
          projectStart={project.start_date}
          projectEnd={project.end_date}
          milestones={milestones}
          monthPlans={monthPlans}
          onRefresh={fetchAll}
        />
      )}
      {activeTab === 'fremdriftsplan' && (!project.start_date || !project.end_date) && (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-[var(--color-text-muted)]">
          Sett start- og sluttdato på prosjektet for å aktivere fremdriftsplanen.
        </div>
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
          periodEnd={planEnd}
          onAdded={fetchAll}
          onRequestDelete={setConfirmDeleteCostId}
        />
      )}

      {/* ── MATERIELL ────────────────────────────────────────────────── */}
      {/* Admin/PL-internt: ikke i SITE_MANAGER_TABS, API-ene 403'er for byggeleder/sub.
          Ingen pris/salgsverdi vises — kun mengder og differanser. */}
      {activeTab === 'materiell' && (
        <MaterialSection
          projectId={project.id}
          materials={materials}
          materialVersions={materialVersions}
          onImported={fetchAll}
          saveMaterialReconciliation={saveMaterialReconciliation}
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
          showEconomy={!isSiteManager}
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

      {/* ── AVSTEMMING ───────────────────────────────────────────────── */}
      {/* Skjult for byggeleder (utelatt fra SITE_MANAGER_TABS); verdi-kolonner
          kun for admin/PL (canSeeValue = !isSiteManager). */}
      {activeTab === 'avstemming' && (
        <ReconciliationSection
          budgetLines={budgetLines}
          allProducts={allProducts}
          allSubs={allSubs}
          productionEntries={productionEntries}
          reconciliationLines={reconciliationLines}
          weeklyReportsWL={weeklyReportsWL}
          productionVersions={productionVersions}
          reconciliationStatusValue={reconStatus}
          canSeeValue={!isSiteManager}
          onAddProductionEntry={addProductionEntry}
          onSaveReconciliationLine={saveReconciliationLine}
          onSetReconciliationStatus={setReconciliationStatus}
          saveProductionBatch={saveProductionBatch}
        />
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
