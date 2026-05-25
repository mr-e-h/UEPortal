'use client'

import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Plus, TrendingUp, CheckCircle, Clock, BarChart3, ChevronDown } from 'lucide-react'
import type { WeeklyReport, WeeklyReportLine, ChangeOrder, GanttMilestone } from '@/types'
import { getCurrentWeek, formatWeekLabel } from '@/lib/utils/weeks'
import { calculateBudgetUsage, type LineWithReportStatus } from '@/lib/utils/budgetUsage'
import NumberInput from '@/components/NumberInput'
import SortableTable from '@/components/SortableTable'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import { useMe } from '@/lib/useMe'

// Lazy-load heavy interactive components — they're only shown after a click
// (modal opens, budget line expands, Gantt tab activated). Keeps the initial
// JS bundle for this page small.
const ChangeOrderModal = dynamic(() => import('@/components/subcontractor/ChangeOrderModal'), { ssr: false })
const BudgetLineChart = dynamic(() => import('@/components/BudgetLineChart'), { ssr: false })
const GanttView = dynamic(() => import('@/components/subcontractor/GanttView'), { ssr: false })
import { fmtNOK as fmt } from '@/lib/format'
import { weeklyReportStatus, weeklyReportLineStatus } from '@/lib/statuses'

type BudgetLineWithProduct = {
  id: string
  product_id: string
  product_name: string
  product_description: string
  unit: string
  budget_quantity: number
  subcontractor_cost_price_snapshot: number
}

type ProjectWithLines = {
  id: string
  name: string
  project_number: string
  customer: string
  county: string
  status: string
  start_date: string
  end_date: string | null
  budget_lines: BudgetLineWithProduct[]
}

type ReportWithLines = WeeklyReport & { lines: WeeklyReportLine[] }

type EnrichedLine = WeeklyReportLine & {
  product_name: string
  unit: string
  customer_price_snapshot: number
  subcontractor_cost_price_snapshot: number
}

type EnrichedReport = WeeklyReport & { lines: EnrichedLine[] }

type UEChangeOrder = Omit<ChangeOrder, 'customer_price_snapshot' | 'total_customer_value' | 'profit'>
type BudgetLineOption = Pick<BudgetLineWithProduct, 'product_id' | 'product_name' | 'unit'> & { cost_price?: number }

export default function SubcontractorProjectPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const { me } = useMe()
  const subcontractorId = me?.subcontractor_id ?? ''
  const [project, setProject] = useState<ProjectWithLines | null>(null)
  const [loading, setLoading] = useState(true)

  const initWeek = getCurrentWeek()
  const [year, setYear] = useState(initWeek.year)
  const [week, setWeek] = useState(initWeek.week)

  const [currentReport, setCurrentReport] = useState<WeeklyReport | null>(null)
  const [allReports, setAllReports] = useState<ReportWithLines[]>([])
  const [inputs, setInputs] = useState<Record<string, { quantity: string; comment: string }>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [creatingDraft, setCreatingDraft] = useState(false)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedData, setExpandedData] = useState<EnrichedReport | null>(null)
  const [showEMModal, setShowEMModal] = useState(false)
  const [editingDraft, setEditingDraft] = useState<UEChangeOrder | null>(null)
  const [changeOrders, setChangeOrders] = useState<UEChangeOrder[]>([])
  const [milestones, setMilestones] = useState<GanttMilestone[]>([])
  const [budgetSearch, setBudgetSearch] = useState('')
  const [expandedBudgetId, setExpandedBudgetId] = useState<string | null>(null)

  const loadProject = useCallback(async (subId: string) => {
    const projs = await fetch(`/api/subcontractor/projects?subcontractor_id=${subId}`).then((r) => r.json()) as ProjectWithLines[]
    const found = projs.find((p) => p.id === id) ?? null
    setProject(found)
    return found
  }, [id])

  const loadHistory = useCallback(async (subId: string) => {
    const reports = await fetch(`/api/weekly-reports?project_id=${id}&subcontractor_id=${subId}&with_lines=true`).then((r) => r.json()) as ReportWithLines[]
    const sorted = reports.sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year
      if (b.week_number !== a.week_number) return b.week_number - a.week_number
      return (b.submission_number ?? 1) - (a.submission_number ?? 1)
    })
    setAllReports(sorted)
    return sorted
  }, [id])

  const loadChangeOrders = useCallback(async (subId: string) => {
    const cos = await fetch(
      `/api/subcontractor/change-orders?project_id=${id}&subcontractor_id=${subId}`
    ).then((r) => r.json()) as UEChangeOrder[]
    setChangeOrders(cos)
  }, [id])

  const loadMilestones = useCallback(async () => {
    const ms = await fetch(`/api/milestones?project_id=${id}`).then((r) => r.json()) as GanttMilestone[]
    setMilestones(ms)
  }, [id])

  async function loadDraftLines(draftId: string) {
    const detail = await fetch(`/api/weekly-reports/${draftId}`).then((r) => r.json()) as EnrichedReport
    const newInputs: Record<string, { quantity: string; comment: string }> = {}
    detail.lines.forEach((l) => {
      newInputs[l.project_budget_line_id] = {
        quantity: l.reported_quantity > 0 ? String(l.reported_quantity) : '',
        comment: l.comment ?? '',
      }
    })
    setInputs(newInputs)
  }

  useEffect(() => {
    if (!me) return
    if (me.role !== 'sub') { router.replace('/login'); return }
    // View-as preview: super-admin posing as `sub` has no subcontractor_id.
    // Send them back to the sub home so they see the empty dashboard rather
    // than getting kicked to login from a deep route.
    if (!me.subcontractor_id) { router.replace('/subcontractor'); return }
    const subId = me.subcontractor_id

    const init = async () => {
      const [, reports] = await Promise.all([
        loadProject(subId),
        loadHistory(subId),
        loadChangeOrders(subId),
        loadMilestones(),
      ])
      const weekReports = reports.filter((r) => r.year === initWeek.year && r.week_number === initWeek.week)
      const draft = weekReports.find((r) => r.status === 'draft') ?? null
      setCurrentReport(draft)
      if (draft) await loadDraftLines(draft.id)
      setLoading(false)
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me])

  async function changeWeek(newYear: number, newWeek: number) {
    if (!subcontractorId) return
    setYear(newYear)
    setWeek(newWeek)
    setSubmitError('')
    setExpandedId(null)
    const weekReports = allReports.filter((r) => r.year === newYear && r.week_number === newWeek)
    const draft = weekReports.find((r) => r.status === 'draft') ?? null
    setCurrentReport(draft)
    if (draft) {
      await loadDraftLines(draft.id)
    } else {
      setInputs({})
    }
  }

  function prevWeek() {
    if (week === 1) { changeWeek(year - 1, 52) } else { changeWeek(year, week - 1) }
  }
  function nextWeek() {
    if (week === 52) { changeWeek(year + 1, 1) } else { changeWeek(year, week + 1) }
  }

  async function createNewDraft() {
    if (!subcontractorId) return
    setCreatingDraft(true)
    const report = await fetch('/api/weekly-reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: id, subcontractor_id: subcontractorId, year, week_number: week }),
    }).then((r) => r.json()) as WeeklyReport
    setCurrentReport(report)
    setInputs({})
    await loadHistory(subcontractorId)
    setCreatingDraft(false)
  }

  // Returns true on success — caller can decide whether to proceed. Previously
  // a failed save() was swallowed and a subsequent submit() would lock in a
  // stale server-side draft.
  async function saveLines(): Promise<boolean> {
    if (!currentReport) return false
    const lines = (project?.budget_lines ?? []).map((bl) => ({
      project_budget_line_id: bl.id,
      reported_quantity: Number(inputs[bl.id]?.quantity ?? 0) || 0,
      comment: inputs[bl.id]?.comment ?? '',
    }))
    try {
      const res = await fetch(`/api/weekly-reports/${currentReport.id}/lines`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }))
        setSubmitError(data.error ?? 'Klarte ikke å lagre linjene')
        return false
      }
      return true
    } catch {
      setSubmitError('Nettverksfeil under lagring — prøv igjen')
      return false
    }
  }

  async function handleSubmit() {
    if (!currentReport) return
    setSubmitting(true)
    setSubmitError('')
    const saved = await saveLines()
    if (!saved) { setSubmitting(false); return }

    const res = await fetch(`/api/weekly-reports/${currentReport.id}/submit`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({} as { error?: string }))
      setSubmitError(data.error ?? 'Innsending feilet')
      setSubmitting(false)
      // Re-load history so UI reflects actual server state (e.g. already-
      // submitted-elsewhere scenario).
      await loadHistory(subcontractorId)
      return
    }
    setCurrentReport(null)
    setInputs({})
    await loadHistory(subcontractorId)
    setSubmitting(false)
  }

  async function handleEMSuccess() {
    await loadChangeOrders(subcontractorId)
    setShowEMModal(false)
    setEditingDraft(null)
  }

  async function toggleExpand(reportId: string) {
    if (expandedId === reportId) { setExpandedId(null); return }
    setExpandedId(reportId)
    const data = await fetch(`/api/weekly-reports/${reportId}`).then((r) => r.json()) as EnrichedReport
    setExpandedData(data)
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Laster...</div>
  if (!project) return <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Prosjekt ikke funnet</div>

  const hasActiveDraft = currentReport !== null && currentReport.status === 'draft'

  const allLinesWithStatus: LineWithReportStatus[] = allReports.flatMap((r) =>
    r.lines.map((l) => ({ ...l, report_status: r.status }))
  )

  // ─── Financial summary ───────────────────────────────────────────────────────
  const totalBudgetValue = project.budget_lines.reduce(
    (s, bl) => s + bl.budget_quantity * bl.subcontractor_cost_price_snapshot, 0
  )
  const totalApprovedValue = allLinesWithStatus
    .filter((l) => l.status === 'approved')
    .reduce((s, l) => {
      const bl = project.budget_lines.find((b) => b.id === l.project_budget_line_id)
      return s + l.reported_quantity * (bl?.subcontractor_cost_price_snapshot ?? 0)
    }, 0)
  const totalPendingValue = allLinesWithStatus
    .filter((l) => l.status === 'pending')
    .reduce((s, l) => {
      const bl = project.budget_lines.find((b) => b.id === l.project_budget_line_id)
      return s + l.reported_quantity * (bl?.subcontractor_cost_price_snapshot ?? 0)
    }, 0)
  const approvedEMValue = changeOrders
    .filter((co) => co.status === 'approved')
    .reduce((s, co) => s + co.total_cost, 0)
  const progressPct = totalBudgetValue > 0 ? Math.min(100, Math.round((totalApprovedValue / totalBudgetValue) * 100)) : 0

  const hasAnyInput = Object.values(inputs).some((v) => Number(v.quantity) > 0)

  const weekSubmissions = allReports.filter((r) => r.year === year && r.week_number === week)
  const weekLines = weekSubmissions.flatMap((r) => r.lines)
  const weeklySummaryRows = project.budget_lines
    .map((bl) => {
      const lines = weekLines.filter((l) => l.project_budget_line_id === bl.id)
      const approved = lines.filter((l) => l.status === 'approved').reduce((s, l) => s + l.reported_quantity, 0)
      const pending = lines.filter((l) => l.status === 'pending').reduce((s, l) => s + l.reported_quantity, 0)
      const rejected = lines.filter((l) => l.status === 'rejected').reduce((s, l) => s + l.reported_quantity, 0)
      const total = approved + pending + rejected
      const approvedValue = approved * bl.subcontractor_cost_price_snapshot
      return { id: bl.id, product_name: bl.product_name, unit: bl.unit, total, approved, pending, rejected, approvedValue }
    })
    .filter((s) => s.total > 0)
  const totalApprovedThisWeek = weeklySummaryRows.reduce((s, r) => s + r.approvedValue, 0)

  const productNameMap = new Map(project.budget_lines.map((bl) => [bl.product_id, bl.product_name]))
  const uniqueProductOptions: BudgetLineOption[] = Array.from(
    new Map(
      project.budget_lines.map((bl) => [bl.product_id, {
        product_id: bl.product_id,
        product_name: bl.product_name,
        unit: bl.unit,
        cost_price: bl.subcontractor_cost_price_snapshot,
      }])
    ).values()
  )

  return (
    <div className="p-6 space-y-6">

      {/* ─── Page header ─────────────────────────────────────────────────────── */}
      <div>
        <Button variant="ghost" href="/subcontractor" className="px-0 text-sm mb-2">
          ← Prosjekter
        </Button>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{project.name}</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
          {project.project_number} · {project.customer} · {project.county}
        </p>
      </div>

      {showEMModal && (
        <ChangeOrderModal
          projectId={id}
          subcontractorId={subcontractorId}
          budgetLines={uniqueProductOptions}
          initialDraft={editingDraft ?? undefined}
          onClose={() => { setShowEMModal(false); setEditingDraft(null) }}
          onSuccess={handleEMSuccess}
        />
      )}

      {/* ─── Financial KPI cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            icon: BarChart3,
            label: 'Ordreverdi',
            value: fmt(totalBudgetValue),
            sub: `${project.budget_lines.length} produktlinjer`,
            color: 'text-indigo-600 bg-indigo-50',
          },
          {
            icon: CheckCircle,
            label: 'Godkjent arbeid',
            value: fmt(totalApprovedValue),
            sub: `${progressPct}% av ordreverdi`,
            color: 'text-green-600 bg-green-50',
          },
          {
            icon: Clock,
            label: 'Til behandling',
            value: fmt(totalPendingValue),
            sub: 'Venter på godkjenning',
            color: 'text-orange-600 bg-orange-50',
          },
          {
            icon: TrendingUp,
            label: 'Godkjente EM',
            value: fmt(approvedEMValue),
            sub: `${changeOrders.filter((co) => co.status === 'approved').length} endringsmeldinger`,
            color: 'text-blue-600 bg-blue-50',
          },
        ].map(({ icon: Icon, label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl border border-border p-4 flex items-start gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-none ${color}`}>
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-bold text-[var(--color-text-primary)] leading-none">{value}</p>
              <p className="text-xs font-medium text-[var(--color-text-primary)] mt-1 leading-tight">{label}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {totalBudgetValue > 0 && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-2">
          <div className="flex justify-between items-center text-xs text-[var(--color-text-muted)]">
            <span className="font-medium text-[var(--color-text-primary)]">Fremdrift (godkjent arbeid)</span>
            <span className="font-semibold text-[var(--color-text-primary)]">{progressPct}%</span>
          </div>
          <div className="h-2.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progressPct}%`,
                backgroundColor: progressPct >= 80 ? '#10B981' : progressPct >= 40 ? '#6366F1' : '#F59E0B',
              }}
            />
          </div>
          <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
            <span>Godkjent: {fmt(totalApprovedValue)}</span>
            <span>Budsjett: {fmt(totalBudgetValue)}</span>
          </div>
        </div>
      )}

      {/* ─── Gantt / Milepæler ───────────────────────────────────────────────── */}
      {milestones.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Fremdriftsplan</h2>
          </div>
          <div className="p-4 overflow-x-auto">
            <GanttView
              milestones={milestones}
              projectStart={project.start_date}
              projectEnd={project.end_date}
            />
          </div>
        </Card>
      )}

      {/* ─── Budsjett-oversikt ───────────────────────────────────────────────── */}
      {project.budget_lines.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-6 py-3 border-b border-border flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Budsjett-oversikt</h2>
            <input
              type="search"
              placeholder="Søk produkt eller kode…"
              value={budgetSearch}
              onChange={(e) => setBudgetSearch(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:border-primary w-52 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="px-4 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide w-24">Kode</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Produkt</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide w-28">Godkjent / Total</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide w-40">Fremdrift</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide w-32">Verdi</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {[...project.budget_lines]
                  .sort((a, b) =>
                    (a.product_description || a.product_name).localeCompare(b.product_description || b.product_name, 'nb')
                  )
                  .filter((bl) => {
                    if (!budgetSearch) return true
                    const q = budgetSearch.toLowerCase()
                    return (
                      bl.product_name.toLowerCase().includes(q) ||
                      bl.product_description.toLowerCase().includes(q)
                    )
                  })
                  .flatMap((bl) => {
                  const usage = calculateBudgetUsage(bl.id, bl.budget_quantity, allLinesWithStatus)
                  const usedPct = bl.budget_quantity > 0
                    ? Math.min(100, Math.round((usage.approved / bl.budget_quantity) * 100))
                    : 0
                  const approvedValue = usage.approved * bl.subcontractor_cost_price_snapshot
                  const budgetValue = bl.budget_quantity * bl.subcontractor_cost_price_snapshot
                  const barColor = usedPct >= 100 ? '#EF4444' : usedPct >= 75 ? '#F59E0B' : '#10B981'
                  const isExpanded = expandedBudgetId === bl.id

                  const approvedCOs = changeOrders
                    .filter((co) => co.product_id === bl.product_id && co.status === 'approved' && co.reviewed_at != null)
                    .sort((a, b) => a.reviewed_at!.localeCompare(b.reviewed_at!))
                  const coTotal = approvedCOs.reduce((s, co) => s + co.requested_quantity, 0)

                  const rows = [
                    <tr
                      key={bl.id}
                      onClick={() => setExpandedBudgetId(isExpanded ? null : bl.id)}
                      className="border-b border-border last:border-0 hover:bg-muted/40 cursor-pointer"
                    >
                      <td className="px-4 py-2.5">
                        {bl.product_description ? (
                          <span className="text-xs font-mono font-medium bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{bl.product_description}</span>
                        ) : (
                          <span className="text-[var(--color-text-muted)]">–</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-[var(--color-text-primary)]">{bl.product_name}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs">
                        <span className="font-semibold text-[var(--color-text-primary)]">{usage.approved}</span>
                        <span className="text-[var(--color-text-muted)]"> / {bl.budget_quantity} {bl.unit}</span>
                        {usage.pending > 0 && (
                          <span className="ml-1 text-orange-500">+{usage.pending}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${usedPct}%`, backgroundColor: barColor }} />
                          </div>
                          <span className="text-[10px] text-[var(--color-text-muted)] w-7 text-right">{usedPct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs">
                        {bl.subcontractor_cost_price_snapshot > 0 ? (
                          <>
                            <span className="font-medium text-green-600">{fmt(approvedValue)}</span>
                            <span className="text-[var(--color-text-muted)]"> / {fmt(budgetValue)}</span>
                          </>
                        ) : '–'}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <ChevronDown
                          size={14}
                          className={`text-[var(--color-text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </td>
                    </tr>,
                  ]

                  if (isExpanded) {
                    rows.push(
                      <tr key={`${bl.id}-chart`} className="bg-muted/30">
                        <td colSpan={6} className="px-0 py-0">
                          <BudgetLineChart
                            productName={bl.product_name}
                            productCode={bl.product_description}
                            unit={bl.unit}
                            importQty={bl.budget_quantity - coTotal}
                            projectStart={project.start_date}
                            approvedCOs={approvedCOs}
                          />
                        </td>
                      </tr>
                    )
                  }

                  return rows
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ─── Lever rapport ───────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Lever rapport</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <button onClick={prevWeek} className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] border border-border rounded-lg hover:bg-muted transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="font-medium text-sm text-[var(--color-text-primary)] min-w-[200px] text-center">{formatWeekLabel(year, week)}</span>
            <button onClick={nextWeek} className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] border border-border rounded-lg hover:bg-muted transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

          {weekSubmissions.length > 0 && (
            <div className="border border-border rounded-lg p-3 bg-muted">
              <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">Innsendinger uke {week}</p>
              {weekSubmissions.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm py-1">
                  <span className="text-[var(--color-text-primary)]">Innsending #{s.submission_number ?? 1}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {s.submitted_at ? new Date(s.submitted_at).toLocaleDateString('nb-NO') : 'Kladd'}
                  </span>
                  {(() => { const m = weeklyReportStatus(s.status); return <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span> })()}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={createNewDraft}
            disabled={creatingDraft || hasActiveDraft}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
            {creatingDraft ? 'Oppretter...' : `Ny innsending uke ${week}`}
          </button>

          {hasActiveDraft && project.budget_lines.length > 0 && (
            <>
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                Innsending #{currentReport!.submission_number ?? 1} — Uke {week}
              </p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted">
                      <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Produkt</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Enhet</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Budsjettert</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Tidl. rapportert</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Gjenstående</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide w-28">Antall</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Kommentar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.budget_lines.map((bl) => {
                      const usage = calculateBudgetUsage(bl.id, bl.budget_quantity, allLinesWithStatus, currentReport?.id)
                      const qty = inputs[bl.id]?.quantity ?? ''
                      const comment = inputs[bl.id]?.comment ?? ''
                      return (
                        <tr key={bl.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                          <td className="px-3 py-2">
                            <div className="font-medium text-[var(--color-text-primary)]">{bl.product_name}</div>
                            {bl.product_description && <div className="text-xs text-[var(--color-text-muted)]">{bl.product_description}</div>}
                          </td>
                          <td className="px-3 py-2 text-[var(--color-text-secondary)]">{bl.unit}</td>
                          <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">{bl.budget_quantity}</td>
                          <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">{usage.approved}</td>
                          <td className={`px-3 py-2 text-right font-medium ${usage.remaining < 0 ? 'text-danger' : 'text-[var(--color-text-primary)]'}`}>
                            {usage.remaining}
                            {usage.pending > 0 && (
                              <span className="text-xs font-normal text-warning ml-1">({usage.pending} venter)</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <NumberInput
                              placeholder="0"
                              value={qty}
                              onChange={(raw) => setInputs((prev) => ({ ...prev, [bl.id]: { ...prev[bl.id], quantity: raw, comment: prev[bl.id]?.comment ?? '' } }))}
                              onBlur={saveLines}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded text-right focus:outline-none focus:border-primary"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              placeholder="Valgfri"
                              value={comment}
                              onChange={(e) => setInputs((prev) => ({ ...prev, [bl.id]: { quantity: prev[bl.id]?.quantity ?? '', comment: e.target.value } }))}
                              onBlur={saveLines}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-primary"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-3">
                {submitError && <span className="text-sm text-danger">{submitError}</span>}
                <Button variant="primary" onClick={handleSubmit} disabled={submitting || !hasAnyInput}>
                  {submitting ? 'Sender inn...' : `Send inn innsending #${currentReport!.submission_number ?? 1}`}
                </Button>
              </div>
            </>
          )}

          {hasActiveDraft && project.budget_lines.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">Ingen produkter tildelt ennå</p>
          )}

          {weeklySummaryRows.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">Ukesrapport — Uke {week}</h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted">
                      <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Produkt</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Enhet</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Totalt</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Godkjent</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Til behandling</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Verdi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklySummaryRows.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-[var(--color-text-primary)]">{row.product_name}</td>
                        <td className="px-3 py-2 text-[var(--color-text-secondary)]">{row.unit}</td>
                        <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">{row.total}</td>
                        <td className="px-3 py-2 text-right font-medium text-success">{row.approved}</td>
                        <td className="px-3 py-2 text-right text-warning">{row.pending}</td>
                        <td className="px-3 py-2 text-right font-medium text-[var(--color-text-primary)]">
                          {row.approvedValue > 0 ? fmt(row.approvedValue) : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {totalApprovedThisWeek > 0 && (
                    <tfoot>
                      <tr className="border-t border-border bg-muted">
                        <td colSpan={5} className="px-3 py-2 text-sm font-medium text-[var(--color-text-primary)]">Totalt godkjent denne uken</td>
                        <td className="px-3 py-2 text-right font-bold text-success">{fmt(totalApprovedThisWeek)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ─── Historikk ───────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Tidligere uker</h2>
        </div>
        {allReports.length === 0 ? (
          <div className="p-6 text-center text-[var(--color-text-muted)] text-sm">Ingen rapporter sendt ennå</div>
        ) : (
          <div className="divide-y divide-border">
            {allReports.map((report) => {
              const lineCount = report.lines.length
              const totalValue = report.lines
                .filter((l) => l.status === 'approved')
                .reduce((s, l) => {
                  const bl = project.budget_lines.find((b) => b.id === l.project_budget_line_id)
                  return s + l.reported_quantity * (bl?.subcontractor_cost_price_snapshot ?? 0)
                }, 0)
              const isExpanded = expandedId === report.id

              return (
                <div key={report.id}>
                  <div className="px-6 py-3.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-[var(--color-text-primary)]">
                          Uke {report.week_number}
                          <span className="text-[var(--color-text-muted)] font-normal ml-1">
                            #{report.submission_number ?? 1}
                          </span>
                        </span>
                        {(() => { const m = weeklyReportStatus(report.status); return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.cls}`}>{m.label}</span> })()}
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {formatWeekLabel(report.year, report.week_number)}
                        {report.submitted_at && (
                          <span className="ml-2">· Innsendt {new Date(report.submitted_at).toLocaleDateString('nb-NO')}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-none">
                      {totalValue > 0 && (
                        <div className="text-sm font-semibold text-success">{fmt(totalValue)}</div>
                      )}
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {lineCount} linje{lineCount !== 1 ? 'r' : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleExpand(report.id)}
                      className="ml-2 p-1.5 rounded-lg hover:bg-muted transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    >
                      <ChevronRight size={16} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>
                  </div>

                  {isExpanded && expandedData?.id === report.id && (
                    <div className="px-6 pb-4">
                      {expandedData.lines.length === 0 ? (
                        <p className="text-sm text-[var(--color-text-muted)] py-2">Ingen linjer i denne rapporten.</p>
                      ) : (() => {
                        type DetailRow = {
                          id: string
                          product_name: string
                          unit: string
                          reported_quantity: number
                          comment: string
                          cost: number
                          status: string
                        }
                        const rows: DetailRow[] = expandedData.lines.map((l) => ({
                          id: l.id,
                          product_name: l.product_name,
                          unit: l.unit,
                          reported_quantity: l.reported_quantity,
                          comment: l.comment || '–',
                          cost: l.reported_quantity * l.subcontractor_cost_price_snapshot,
                          status: l.status,
                        }))
                        return (
                          <SortableTable
                            columns={[
                              { key: 'product_name', label: 'Produkt', sortable: true },
                              { key: 'unit', label: 'Enhet' },
                              { key: 'reported_quantity', label: 'Mengde', sortable: true },
                              { key: 'comment', label: 'Kommentar' },
                              { key: 'cost', label: 'Verdi', sortable: true, getValue: (r: DetailRow) => r.cost, render: (r: DetailRow) => fmt(r.cost) },
                              {
                                key: 'status',
                                label: 'Status',
                                sortable: true,
                                render: (r: DetailRow) => {
                                  const m = weeklyReportLineStatus(r.status)
                                  return <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>
                                },
                              },
                            ]}
                            data={rows}
                            emptyText="Ingen linjer"
                          />
                        )
                      })()}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* ─── Endringsmeldinger ───────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Endringsmeldinger</h2>
          <Button
            variant="primary"
            onClick={() => { setEditingDraft(null); setShowEMModal(true) }}
            className="px-3 py-1.5 text-xs"
          >
            + Send endringsmelding
          </Button>
        </div>
        {changeOrders.length === 0 ? (
          <div className="p-6 text-center text-[var(--color-text-muted)] text-sm">
            Ingen endringsmeldinger sendt ennå
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Produkt</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Mengde</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Kostnad</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Begrunnelse</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Vedlegg</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Innsendt</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Kommentar</th>
                </tr>
              </thead>
              <tbody>
                {changeOrders.map((co) => (
                  <tr
                    key={co.id}
                    className={`border-b border-border last:border-0 ${
                      co.status === 'draft' ? 'cursor-pointer hover:bg-muted/50' : ''
                    }`}
                    onClick={
                      co.status === 'draft'
                        ? () => { setEditingDraft(co); setShowEMModal(true) }
                        : undefined
                    }
                  >
                    <td className="px-3 py-2 font-medium text-[var(--color-text-primary)]">
                      {productNameMap.get(co.product_id) ?? '–'}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">
                      {co.requested_quantity} {co.unit}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                      {fmt(co.total_cost)}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                      <span title={co.reason}>
                        {co.reason.length > 50 ? co.reason.slice(0, 50) + '…' : co.reason}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {co.attachment_url ? (
                        <a
                          href={`/api/change-orders/${co.id}/attachment?redirect=1`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary text-xs hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Se vedlegg
                        </a>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">–</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge status={co.status} />
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)] whitespace-nowrap">
                      {co.submitted_at?.split('T')[0] ?? '–'}
                    </td>
                    <td className="px-3 py-2">
                      {co.status === 'rejected' && co.admin_comment ? (
                        <span className="text-xs text-danger">{co.admin_comment}</span>
                      ) : co.status === 'draft' ? (
                        <span className="text-xs text-primary">Klikk for å redigere</span>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">–</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
