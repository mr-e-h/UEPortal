'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Plus, TrendingUp, CheckCircle, Clock, BarChart3, ChevronDown, Wallet, Receipt, AlertTriangle, Copy } from 'lucide-react'
import type { WeeklyReport, WeeklyReportLine, ChangeOrder, GanttMilestone, ActivityEntry, PhaseType, ProjectPhase } from '@/types'
import { getCurrentWeek, formatWeekLabel, prevWeek as prevISOWeek, nextWeek as nextISOWeek } from '@/lib/utils/weeks'
import { calculateBudgetUsage, type LineWithReportStatus } from '@/lib/utils/budgetUsage'
import NumberInput from '@/components/NumberInput'
import SortableTable from '@/components/SortableTable'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import StatusPill from '@/components/ui/StatusPill'
import { useMe } from '@/lib/useMe'
import { api } from '@/lib/api'
import { readyToInvoice } from '@/lib/economy'
import type { SubcontractorProjectData } from '@/lib/subcontractor-project-detail'

// Lazy-load heavy interactive components — they're only shown after a click
// (modal opens, budget line expands, Gantt tab activated). Keeps the initial
// JS bundle for this page small.
const ChangeOrderModal = dynamic(() => import('@/components/subcontractor/ChangeOrderModal'), { ssr: false })
const BudgetLineChart = dynamic(() => import('@/components/BudgetLineChart'), { ssr: false })
const GanttView = dynamic(() => import('@/components/subcontractor/GanttView'), { ssr: false })
const VersionDiffModal = dynamic(() => import('@/components/admin/VersionDiffModal'), { ssr: false })
const UEFremdriftsplan = dynamic(() => import('@/components/subcontractor/UEFremdriftsplan'), { ssr: false })
import { fmtNOK as fmt } from '@/lib/format'
import { weeklyReportStatus, weeklyReportLineStatus, changeOrderType, changeOrderPill } from '@/lib/statuses'
import { emNeedsRevision } from '@/lib/attention'

type ReportWithLines = WeeklyReport & { lines: WeeklyReportLine[] }

type EnrichedLine = WeeklyReportLine & {
  product_name: string
  unit: string
  customer_price_snapshot: number
  subcontractor_cost_price_snapshot: number
}

type EnrichedReport = WeeklyReport & { lines: EnrichedLine[] }

// API legger til has_admin_edits + has_consequence_lines etter UE-strip
// av kundepris-felter. Se app/api/subcontractor/change-orders/route.ts.
type UEChangeOrder = Omit<ChangeOrder, 'customer_price_snapshot' | 'total_customer_value' | 'profit'> & {
  has_admin_edits: boolean
  has_consequence_lines: boolean
}

// Konsekvens-linje slik UE ser den fra /api/change-orders/[id]/consequence-lines —
// customer_price_snapshot er strippet ut av endepunktet. Brukes til read-only
// rendring i prosjekt-detalj-tabellen og inne i ChangeOrderModal.
type UEConsequenceLine = {
  id: string
  product_id: string
  quantity: number
  unit: string
  cost_price_snapshot: number
  sort_order: number
}
type BudgetLineOption = Pick<SubcontractorProjectData['budget_lines'][number], 'product_id' | 'product_name' | 'unit'> & { cost_price?: number }

// Faner på prosjekt-detaljsiden (S.1). Handling (send EM / lever rapport)
// ligger på henholdsvis Endringsmeldinger- og Rapportering-fanen, som begge
// er lett tilgjengelige i fane-raden.
const TABS = [
  { id: 'oversikt', label: 'Oversikt' },
  { id: 'budsjett', label: 'Budsjett' },
  { id: 'rapportering', label: 'Rapportering' },
  { id: 'endringsmeldinger', label: 'Endringsmeldinger' },
  { id: 'fakturering', label: 'Fakturering' },
] as const
type TabId = (typeof TABS)[number]['id']

interface Props {
  /** Server-fetched initial project data. Seeds `project` state immediately
   *  so the page renders with content — no blank-screen spinner. */
  initialData: SubcontractorProjectData
}

export default function ProjectDetailClient({ initialData }: Props) {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const { me } = useMe()
  const subcontractorId = me?.subcontractor_id ?? ''

  // Seed project state from SSR data — no spinner on first render.
  const [project, setProject] = useState<SubcontractorProjectData>(initialData)

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

  // ─── Fane-navigasjon (S.1) ───────────────────────────────────────────────
  // Oversikt / Budsjett / Rapportering / Endringsmeldinger / Fakturering.
  // De tunge seksjonene (Gantt/Fremdriftsplan/budsjett-graf/EM-modal) lazy-
  // lastes fortsatt — fanene styrer bare hvilke Card-seksjoner som monteres.
  const [activeTab, setActiveTab] = useState<TabId>('oversikt')

  // Ukesrapport-flyt: ref til «Lever rapport»-kortet så ?action=weekly-report
  // (og fane-bytte) kan scrolle det inn i view, og en suksess-banner +
  // fremhevet rad etter innsending (2.4).
  const reportCardRef = useRef<HTMLDivElement>(null)
  const [submitSuccess, setSubmitSuccess] = useState<{ week: number; year: number } | null>(null)
  const [highlightReportId, setHighlightReportId] = useState<string | null>(null)

  // Dashboard quick action: when the picker sends us here with ?action=new-em,
  // auto-open the EM modal (+ switch to the Endringsmeldinger tab so the modal
  // opens over the right surface). Strip the param afterwards so a page refresh
  // doesn't pop it back open.
  useEffect(() => {
    if (searchParams.get('action') !== 'new-em') return
    setActiveTab('endringsmeldinger')
    setShowEMModal(true)
    const url = new URL(window.location.href)
    url.searchParams.delete('action')
    window.history.replaceState({}, '', url.toString())
  }, [searchParams])

  // Sett til true av ?action=weekly-report — håndteres i en egen effekt som
  // venter til data er lastet (createNewDraft trenger subcontractorId +
  // ferdiglastet historikk). Strip param her så refresh ikke trigger på nytt.
  const [pendingWeeklyAction, setPendingWeeklyAction] = useState(false)
  // loading tracks whether the secondary async data (history, change orders)
  // is still being fetched — project itself is seeded from initialData.
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (searchParams.get('action') !== 'weekly-report') return
    setPendingWeeklyAction(true)
    setActiveTab('rapportering')
    const url = new URL(window.location.href)
    url.searchParams.delete('action')
    window.history.replaceState({}, '', url.toString())
  }, [searchParams])

  const [editingDraft, setEditingDraft] = useState<UEChangeOrder | null>(null)
  const [changeOrders, setChangeOrders] = useState<UEChangeOrder[]>([])
  const [milestones, setMilestones] = useState<GanttMilestone[]>([])
  const [phases, setPhases] = useState<ProjectPhase[]>([])
  const [phaseTypes, setPhaseTypes] = useState<PhaseType[]>([])
  const [budgetSearch, setBudgetSearch] = useState('')
  const [expandedBudgetId, setExpandedBudgetId] = useState<string | null>(null)
  // Versjonsdiff-popup når UE klikker 'Se endringer'. /api/activity har
  // allerede strippet customer_price_snapshot, total_customer_value og
  // profit rekursivt — UE ser kun trygge felter i diff-tabellen.
  const [diffEntry, setDiffEntry] = useState<ActivityEntry | null>(null)
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null)
  // Konsekvens-linjer: lastes lazy per EM når UE klikker 'Vis konsekvens'.
  // Customer-pris er allerede strippet av /api/change-orders/[id]/consequence-lines.
  const [expandedConseqId, setExpandedConseqId] = useState<string | null>(null)
  const [conseqCache, setConseqCache] = useState<Record<string, UEConsequenceLine[]>>({})
  const [loadingConseq, setLoadingConseq] = useState<string | null>(null)

  async function openLatestEdit(coId: string) {
    setLoadingDiff(coId)
    try {
      const res = await fetch(`/api/activity?entity_id=${coId}&entity_type=change_order`)
      if (!res.ok) return
      const all = (await res.json()) as ActivityEntry[]
      // /api/activity returnerer oldest-first; vi vil ha siste 'edited'.
      const lastEdited = [...all].reverse().find((e) => e.action === 'edited')
      if (lastEdited) setDiffEntry(lastEdited)
    } finally {
      setLoadingDiff(null)
    }
  }

  async function toggleConsequence(coId: string) {
    if (expandedConseqId === coId) {
      setExpandedConseqId(null)
      return
    }
    if (!conseqCache[coId]) {
      setLoadingConseq(coId)
      try {
        const res = await fetch(`/api/change-orders/${coId}/consequence-lines`)
        if (res.ok) {
          const lines = (await res.json()) as UEConsequenceLine[]
          setConseqCache((prev) => ({ ...prev, [coId]: lines }))
        }
      } finally {
        setLoadingConseq(null)
      }
    }
    setExpandedConseqId(coId)
  }

  // loadProject refreshes the project data after mutations. On initial mount
  // the project is already seeded from initialData, so this only runs on
  // explicit refresh calls (e.g. after a mutation).
  const loadProject = useCallback(async () => {
    const res = await fetch(`/api/subcontractor/projects/${id}`)
    if (!res.ok) {
      setProject(initialData) // keep existing data on error
      return null
    }
    const found = (await res.json()) as SubcontractorProjectData
    setProject(found)
    return found
  }, [id, initialData])

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
    const ms = await api.milestones.list(id).catch(() => [] as GanttMilestone[])
    setMilestones(ms)
  }, [id])

  const loadPhases = useCallback(async () => {
    try {
      const res = await fetch(`/api/subcontractor/phases?project_id=${id}`)
      if (!res.ok) return
      const data = (await res.json()) as { phases: ProjectPhase[]; phaseTypes: PhaseType[] }
      setPhases(data.phases ?? [])
      setPhaseTypes(data.phaseTypes ?? [])
    } catch {
      // Soft-fail — phases section simply stays empty
    }
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
    // Server layout is the authoritative role gate; don't redirect to /login
    // here or we race the ViewAsBar navigation when exiting view-as (role
    // flips to 'main' for one render). Just skip the sub-only fetch.
    if (me.role !== 'sub') return
    // View-as preview: super-admin posing as `sub` has no subcontractor_id.
    // Send them back to the sub home so they see the empty dashboard rather
    // than getting kicked to login from a deep route.
    if (!me.subcontractor_id) { router.replace('/subcontractor'); return }
    const subId = me.subcontractor_id

    const init = async () => {
      // Project is already seeded from initialData — only fetch secondary data
      // (history, change orders, milestones, phases) which are not part of the
      // server-loaded initial project shape.
      const [, reports] = await Promise.all([
        loadProject(),
        loadHistory(subId),
        loadChangeOrders(subId),
        loadMilestones(),
        loadPhases(),
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

  // 2.1 — picker-snarvei (?action=weekly-report): når data er lastet, bytt til
  // Rapportering-fanen (gjort i action-effekten over), scroll «Lever rapport»-
  // kortet inn i view og start en kladd automatisk hvis den valgte uka ikke
  // alt har en aktiv kladd. Samme mekanisme som ?action=new-em, bare for rapport.
  useEffect(() => {
    if (!pendingWeeklyAction || loading) return
    setPendingWeeklyAction(false)
    const run = async () => {
      if (!(currentReport && currentReport.status === 'draft')) {
        await createNewDraft()
      }
      // Vent en frame så kortet er montert på Rapportering-fanen før scroll.
      requestAnimationFrame(() => {
        reportCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
    run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingWeeklyAction, loading])

  async function changeWeek(newYear: number, newWeek: number) {
    if (!subcontractorId) return
    setYear(newYear)
    setWeek(newWeek)
    setSubmitError('')
    setSubmitSuccess(null)
    setHighlightReportId(null)
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

  // Walk weeks via the ISO-aware helpers so years like 2026 (53 weeks) can
  // be reached at all and rolling backward from uke 1 lands on uke 53 / 52
  // depending on the previous year.
  function prevWeek() {
    const next = prevISOWeek(year, week)
    changeWeek(next.year, next.week)
  }
  function nextWeek() {
    const next = nextISOWeek(year, week)
    changeWeek(next.year, next.week)
  }

  async function createNewDraft(): Promise<WeeklyReport | null> {
    if (!subcontractorId) return null
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
    return report
  }

  // 2.2 — «Kopier forrige uke»: fyll Antall-kolonnen med mengdene fra den
  // SENESTE innsendte uka FØR den valgte uka. Bevisst klikk (ikke auto), så
  // UE bare overstyrer det som er endret. Bruker allReports som alt er lastet
  // og sortert nyest-først. Krever en aktiv kladd; tomme verdier hoppes over.
  function copyPreviousWeek() {
    // Finn først den seneste innsendte uka strengt før den valgte.
    const prev = allReports.find(
      (r) =>
        r.status !== 'draft' &&
        (r.year < year || (r.year === year && r.week_number < week))
    )
    if (!prev) return
    // Summer mengde per budsjettlinje over ALLE innsendinger den uka (en uke
    // kan ha flere innsendinger / submission_number).
    const qtyByLine = new Map<string, number>()
    allReports
      .filter((r) => r.status !== 'draft' && r.year === prev.year && r.week_number === prev.week_number)
      .forEach((r) =>
        r.lines.forEach((l) => {
          qtyByLine.set(
            l.project_budget_line_id,
            (qtyByLine.get(l.project_budget_line_id) ?? 0) + l.reported_quantity
          )
        })
      )
    setInputs((current) => {
      const next = { ...current }
      ;(project?.budget_lines ?? []).forEach((bl) => {
        const q = qtyByLine.get(bl.id) ?? 0
        if (q > 0) {
          next[bl.id] = { quantity: String(q), comment: next[bl.id]?.comment ?? '' }
        }
      })
      return next
    })
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
    setSubmitSuccess(null)
    const saved = await saveLines()
    if (!saved) { setSubmitting(false); return }

    const submittedId = currentReport.id
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
    // 2.4 — positiv kvittering: inline suksess-banner + fremhev den nye raden.
    setSubmitSuccess({ week, year })
    setHighlightReportId(submittedId)
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

  // 3.2 — Gjenstår budsjett (kr) = mitt budsjett − godkjent kost. Kan bli
  // negativ når UE har produsert/EM-et utover opprinnelig ordre; vises rødt da.
  const remainingBudgetValue = totalBudgetValue - totalApprovedValue
  const remainingPct = totalBudgetValue > 0
    ? Math.max(0, Math.round((remainingBudgetValue / totalBudgetValue) * 100))
    : 0

  // 4.6 — Klart til fakturering = godkjent kost + godkjente EM − allerede
  // fakturert (invoiced_value fra server). Ren kost, ingen kundepris.
  const invoicedValue = project.invoiced_value ?? 0
  const readyToInvoiceValue = readyToInvoice({
    approvedWork: totalApprovedValue,
    approvedChangeOrders: approvedEMValue,
    invoiced: invoicedValue,
  })

  // 3.4 — segment-bredder for den stablede fremdriftsbaren. Nevneren er det
  // største av budsjett og faktisk produsert (godkjent + til behandling), så
  // overproduksjon ikke får baren til å renne over 100 %.
  const barDenominator = Math.max(totalBudgetValue, totalApprovedValue + totalPendingValue, 1)
  const wApproved = (totalApprovedValue / barDenominator) * 100
  const wPending = (totalPendingValue / barDenominator) * 100
  const wRemaining = Math.max(0, 100 - wApproved - wPending)
  // Kroneverdien som svarer til grå-segmentets BREDDE (budsjett − godkjent − til
  // behandling). Brukes i bar-tooltip/forklaring så tall og bredde stemmer; KPI-
  // kortet «Gjenstår budsjett» bruker bevisst remainingBudgetValue (uten pending).
  const barRemainingValue = Math.max(0, barDenominator - totalApprovedValue - totalPendingValue)

  // 1.5 — antall EM-er som trenger UE-revisjon (klient-side fra lastet data).
  const revisionCount = changeOrders.filter((co) => emNeedsRevision(co.status)).length

  const hasAnyInput = Object.values(inputs).some((v) => Number(v.quantity) > 0)

  // 2.2 — finnes det en innsendt uke FØR den valgte å kopiere fra?
  const hasPreviousWeek = allReports.some(
    (r) =>
      r.status !== 'draft' &&
      (r.year < year || (r.year === year && r.week_number < week))
  )

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

  // UE ser KUN antall per produkt: slå sammen budsjettlinjer på samme produkt
  // (prisperioder fra indeksregulering har samme UE-pris) til én rad med total
  // mengde + summert forbruk. UE ganger opp med sin egen pris.
  const budgetGroups = (() => {
    const map = new Map<string, Array<(typeof project.budget_lines)[number]>>()
    for (const bl of project.budget_lines) {
      const arr = map.get(bl.product_id) ?? []
      arr.push(bl)
      map.set(bl.product_id, arr)
    }
    return Array.from(map.entries()).map(([pid, lines]) => {
      const first = lines[0]
      const totalQty = lines.reduce((s, l) => s + l.budget_quantity, 0)
      let approved = 0
      let pending = 0
      for (const l of lines) {
        const u = calculateBudgetUsage(l.id, l.budget_quantity, allLinesWithStatus)
        approved += u.approved
        pending += u.pending
      }
      return {
        key: pid,
        product_id: pid,
        product_name: first.product_name,
        product_description: first.product_description,
        unit: first.unit,
        totalQty,
        approved,
        pending,
        remaining: totalQty - approved,
        price: first.subcontractor_cost_price_snapshot,
      }
    })
  })()
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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button variant="ghost" href="/subcontractor/projects" className="px-0 text-sm mb-2">
            ← Prosjekter
          </Button>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{project.name}</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            {project.project_number} · {project.customer} · {project.county}
          </p>
        </div>

        {/* Contact card — who to reach about this project on the Netel side */}
        {project.project_managers && project.project_managers.length > 0 && (
          <div className="bg-card border border-border rounded-lg px-4 py-3 min-w-[220px]">
            <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
              {project.project_managers.length > 1 ? 'Kontaktpersoner' : 'Kontaktperson'}
            </p>
            <ul className="space-y-1.5">
              {project.project_managers.map((pm) => (
                <li key={pm.id} className="text-xs">
                  <div className="font-medium text-[var(--color-text-primary)]">{pm.full_name}</div>
                  <a href={`mailto:${pm.email}`} className="text-primary hover:underline">{pm.email}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
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

      {/* Versjonsdiff-popup — åpnes når UE klikker "Se endringer"-link
          på en EM. /api/activity strip-er customer_price_snapshot,
          total_customer_value og profit rekursivt fra metadata før
          det havner her, så UE ser bare trygge felter.
          productNameLookup gjør at produkt-IDer i diff-tabellen
          rendres som lesbare 'KODE - Navn'-strenger fra prosjektets
          budsjett-data. */}
      <VersionDiffModal
        entry={diffEntry}
        productNameLookup={(pid) => productNameMap.get(pid) ?? pid}
        onClose={() => setDiffEntry(null)}
      />

      {/* ─── Fane-navigasjon (S.1) ────────────────────────────────────────────── */}
      <div className="border-b border-border">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
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
              {tab.id === 'endringsmeldinger' && revisionCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">
                  {revisionCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ═══ FANE: OVERSIKT ═══════════════════════════════════════════════════ */}
      {activeTab === 'oversikt' && (
      <>
      {/* ─── Financial KPI cards ──────────────────────────────────────────────── */}
      {/* S.7 — entydige etiketter: «Mitt budsjett» (UE-eget kostbudsjett, ikke
          salgsverdi mot kunde) og «Gjenstår budsjett» (budsjett−godkjent, ikke
          «gjenstår å fakturere»). 3.2 = Gjenstår-kortet, 4.6 = Klart til
          fakturering-kortet med lenke til fakturagrunnlaget. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {([
          {
            icon: BarChart3,
            label: 'Mitt budsjett',
            value: fmt(totalBudgetValue),
            sub: `${project.budget_lines.length} produktlinjer`,
            color: 'text-indigo-600 bg-indigo-50',
          },
          {
            icon: CheckCircle,
            label: 'Godkjent arbeid',
            value: fmt(totalApprovedValue),
            sub: `${progressPct}% av budsjett`,
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
            icon: Wallet,
            label: 'Gjenstår budsjett',
            value: fmt(remainingBudgetValue),
            sub: `${remainingPct}% igjen av budsjett`,
            color: 'text-slate-600 bg-slate-100',
            valueClass: remainingBudgetValue < 0 ? 'text-danger' : undefined,
          },
          {
            icon: TrendingUp,
            label: 'Godkjente EM',
            value: fmt(approvedEMValue),
            sub: `${changeOrders.filter((co) => co.status === 'approved').length} endringsmeldinger`,
            color: 'text-blue-600 bg-blue-50',
          },
          {
            icon: Receipt,
            label: 'Klart til fakturering',
            value: fmt(readyToInvoiceValue),
            sub: 'Se fakturagrunnlag →',
            color: 'text-emerald-600 bg-emerald-50',
            href: `/subcontractor/invoice-basis?project=${id}`,
            valueClass: readyToInvoiceValue < 0 ? 'text-danger' : undefined,
          },
        ] as {
          icon: typeof BarChart3
          label: string
          value: string
          sub: string
          color: string
          href?: string
          valueClass?: string
        }[]).map(({ icon: Icon, label, value, sub, color, href, valueClass }) => {
          const inner = (
            <>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-none ${color}`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <p className={`text-xl font-bold leading-none ${valueClass ?? 'text-[var(--color-text-primary)]'}`}>{value}</p>
                <p className="text-xs font-medium text-[var(--color-text-primary)] mt-1 leading-tight">{label}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{sub}</p>
              </div>
            </>
          )
          return href ? (
            <Link
              key={label}
              href={href}
              className="bg-white rounded-xl border border-border p-4 flex items-start gap-3 hover:border-primary/40 hover:shadow-sm transition-colors"
            >
              {inner}
            </Link>
          ) : (
            <div key={label} className="bg-white rounded-xl border border-border p-4 flex items-start gap-3">
              {inner}
            </div>
          )
        })}
      </div>

      {/* Stablet fremdriftsbar (3.4): Godkjent / Til behandling / Gjenstår,
          hver med kronetooltip. Speiler admin-heroens bar (ProjectStatusHero). */}
      {totalBudgetValue > 0 && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-2">
          <div className="flex justify-between items-center text-xs text-[var(--color-text-muted)]">
            <span className="font-medium text-[var(--color-text-primary)]">Fremdrift</span>
            <span className="font-semibold text-[var(--color-text-primary)]">{progressPct}% godkjent</span>
          </div>
          <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-muted">
            {wApproved > 0 && (
              <div className="h-full bg-green-500" style={{ width: `${wApproved}%` }} title={`Godkjent: ${fmt(totalApprovedValue)}`} />
            )}
            {wPending > 0 && (
              <div className="h-full bg-amber-400" style={{ width: `${wPending}%` }} title={`Til behandling: ${fmt(totalPendingValue)}`} />
            )}
            {wRemaining > 0 && (
              <div className="h-full bg-gray-200" style={{ width: `${wRemaining}%` }} title={`Gjenstår: ${fmt(barRemainingValue)}`} />
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500" /> Godkjent: {fmt(totalApprovedValue)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" /> Til behandling: {fmt(totalPendingValue)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-gray-300" /> Gjenstår: {fmt(barRemainingValue)}
            </span>
            <span className="ml-auto">Budsjett: {fmt(totalBudgetValue)}</span>
          </div>
        </div>
      )}

      {/* ─── Gantt / Milepæler ───────────────────────────────────────────────── */}
      {milestones.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Milepæler</h2>
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

      {/* ─── Fremdriftsplan (faser) ──────────────────────────────────────────── */}
      {phases.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Fremdriftsplan</h2>
          </div>
          <div className="p-4 overflow-x-auto">
            <UEFremdriftsplan
              phases={phases}
              phaseTypes={phaseTypes}
              mySubId={subcontractorId || null}
              projectStart={project.start_date}
              projectEnd={project.end_date}
            />
          </div>
        </Card>
      )}
      </>
      )}

      {/* ═══ FANE: BUDSJETT ═══════════════════════════════════════════════════ */}
      {activeTab === 'budsjett' && (
      <>
      {project.budget_lines.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-[var(--color-text-muted)]">
          Ingen produkter tildelt på dette prosjektet ennå.
        </div>
      )}
      {/* ─── Budsjett-oversikt ───────────────────────────────────────────────── */}
      {project.budget_lines.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-6 py-3 border-b border-border flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Mine produktlinjer</h2>
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
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Produkt</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide w-28">Avtalt pris</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide w-28">Godkjent / Total</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide w-24">Gjenstående</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide w-40">Fremdrift</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide w-32">Verdi</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {budgetGroups
                  .slice()
                  .sort((a, b) =>
                    (a.product_description || a.product_name).localeCompare(b.product_description || b.product_name, 'nb')
                  )
                  .filter((g) => {
                    if (!budgetSearch) return true
                    const q = budgetSearch.toLowerCase()
                    return (
                      g.product_name.toLowerCase().includes(q) ||
                      g.product_description.toLowerCase().includes(q)
                    )
                  })
                  .flatMap((g) => {
                  const usedPct = g.totalQty > 0
                    ? Math.min(100, Math.round((g.approved / g.totalQty) * 100))
                    : 0
                  const approvedValue = g.approved * g.price
                  const budgetValue = g.totalQty * g.price
                  const barColor = usedPct >= 100 ? '#EF4444' : usedPct >= 75 ? '#F59E0B' : '#10B981'
                  const isExpanded = expandedBudgetId === g.key

                  const approvedCOs = changeOrders
                    .filter((co) => co.product_id === g.product_id && co.status === 'approved' && co.reviewed_at != null)
                    .sort((a, b) => a.reviewed_at!.localeCompare(b.reviewed_at!))
                  const coTotal = approvedCOs.reduce((s, co) => s + co.requested_quantity, 0)

                  const rows = [
                    <tr
                      key={g.key}
                      onClick={() => setExpandedBudgetId(isExpanded ? null : g.key)}
                      className="border-b border-border last:border-0 hover:bg-muted/40 cursor-pointer"
                    >
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-[var(--color-text-primary)]">{g.product_name}</span>
                      </td>
                      {/* S.8 — UE-ens egen avtalte enhetspris (trygt: UE-eget kosttall) */}
                      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs text-[var(--color-text-secondary)]">
                        {g.price > 0 ? (
                          <>{fmt(g.price)}<span className="text-[var(--color-text-muted)]">/{g.unit}</span></>
                        ) : '–'}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs">
                        <span className="font-semibold text-[var(--color-text-primary)]">{g.approved}</span>
                        <span className="text-[var(--color-text-muted)]"> / {g.totalQty} {g.unit}</span>
                        {g.pending > 0 && (
                          <span className="ml-1 text-orange-500">+{g.pending}</span>
                        )}
                      </td>
                      {/* 3.3 — gjenstående mengde, alltid synlig (ikke bak en kladd).
                          Rød når negativ (overprodusert mot budsjett). */}
                      <td className={`px-3 py-2.5 text-right whitespace-nowrap text-xs font-medium ${g.remaining < 0 ? 'text-danger' : 'text-[var(--color-text-primary)]'}`}>
                        {g.remaining} {g.unit}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${usedPct}%`, backgroundColor: barColor }} />
                          </div>
                          <span className="text-[10px] text-[var(--color-text-muted)] w-7 text-right">{usedPct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs">
                        {g.price > 0 ? (
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
                      <tr key={`${g.key}-chart`} className="bg-muted/30">
                        <td colSpan={7} className="px-0 py-0">
                          <BudgetLineChart
                            productName={g.product_name}
                            unit={g.unit}
                            importQty={g.totalQty - coTotal}
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
      </>
      )}

      {/* ═══ FANE: RAPPORTERING ═══════════════════════════════════════════════ */}
      {activeTab === 'rapportering' && (
      <>
      {/* ─── Lever rapport ───────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div ref={reportCardRef} className="px-6 py-4 border-b border-border scroll-mt-4">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Lever rapport</h2>
        </div>
        <div className="p-6 space-y-4">
          {/* 2.4 — suksess-banner etter innsending (ingen toast finnes, så en
              liten inline-banner). Vises til neste innsending / uke-bytte. */}
          {submitSuccess && (
            <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              <CheckCircle size={16} className="flex-none mt-0.5 text-green-600" />
              <span>Rapport for uke {submitSuccess.week} sendt — venter på godkjenning.</span>
            </div>
          )}

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

          {project.budget_lines.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Ingen produkter tildelt på dette prosjektet ennå.</p>
          ) : (
            <>
              {/* 2.3 — budsjettlinje-tabellen vises ALLTID. Uten aktiv kladd er
                  den read-only med en «Start rapport»-knapp; ingen blokk bak
                  «Ny innsending» lenger. 2.2 = «Kopier forrige uke». */}
              <div className="flex flex-wrap items-center gap-2">
                {hasActiveDraft ? (
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Innsending #{currentReport!.submission_number ?? 1} — Uke {week}
                  </p>
                ) : (
                  <button
                    onClick={() => createNewDraft()}
                    disabled={creatingDraft}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus size={14} />
                    {creatingDraft ? 'Oppretter...' : `Start rapport uke ${week}`}
                  </button>
                )}
                {hasActiveDraft && hasPreviousWeek && (
                  <button
                    type="button"
                    onClick={copyPreviousWeek}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] border border-border rounded-lg hover:bg-muted transition-colors"
                    title="Fyll Antall-kolonnen med forrige innsendte ukes mengder"
                  >
                    <Copy size={14} />
                    Kopier forrige uke
                  </button>
                )}
              </div>

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
                            {hasActiveDraft ? (
                              <NumberInput
                                placeholder="0"
                                value={qty}
                                onChange={(raw) => setInputs((prev) => ({ ...prev, [bl.id]: { ...prev[bl.id], quantity: raw, comment: prev[bl.id]?.comment ?? '' } }))}
                                onBlur={saveLines}
                                className="w-full px-2 py-1 text-sm border border-border rounded text-right focus:outline-none focus:border-primary"
                              />
                            ) : (
                              <div className="text-right text-[var(--color-text-muted)]">–</div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {hasActiveDraft ? (
                              <input
                                type="text"
                                placeholder="Valgfri"
                                value={comment}
                                onChange={(e) => setInputs((prev) => ({ ...prev, [bl.id]: { quantity: prev[bl.id]?.quantity ?? '', comment: e.target.value } }))}
                                onBlur={saveLines}
                                className="w-full px-2 py-1 text-sm border border-border rounded focus:outline-none focus:border-primary"
                              />
                            ) : (
                              <span className="text-[var(--color-text-muted)]">–</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {hasActiveDraft && (
                <div className="flex flex-wrap items-center gap-3">
                  {submitError && <span className="text-sm text-danger">{submitError}</span>}
                  <Button variant="primary" onClick={handleSubmit} disabled={submitting || !hasAnyInput}>
                    {submitting ? 'Sender inn...' : `Send inn rapport #${currentReport!.submission_number ?? 1}`}
                  </Button>
                  {/* 2.5 — forklar hvorfor knappen er grå */}
                  {!hasAnyInput && !submitting && (
                    <span className="text-xs text-[var(--color-text-muted)]">Skriv inn minst én mengde for å sende inn</span>
                  )}
                </div>
              )}
            </>
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
              const isHighlighted = highlightReportId === report.id

              return (
                <div key={report.id} className={isHighlighted ? 'bg-green-50/60 ring-1 ring-inset ring-green-200' : ''}>
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
      </>
      )}

      {/* ═══ FANE: ENDRINGSMELDINGER ══════════════════════════════════════════ */}
      {activeTab === 'endringsmeldinger' && (
      <>
      {/* 1.5 — oransje varselbånd over EM-listen når noen EM-er trenger UE-
          revisjon. Telleren utledes klient-side fra data som alt er lastet. */}
      {revisionCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <AlertTriangle size={16} className="flex-none mt-0.5 text-orange-600" />
          <span>
            <span className="font-semibold">{revisionCount} endringsmelding{revisionCount !== 1 ? 'er' : ''}</span>
            {' '}trenger revisjon. Klikk på raden{revisionCount !== 1 ? 'e' : ''} merket «Trenger revisjon» for å rette opp og sende inn på nytt.
          </span>
        </div>
      )}

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
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide w-12">Nr</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Produkt</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Mengde</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Kostnad</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Beskrivelse</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Vedlegg</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Innsendt</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Kommentar</th>
                </tr>
              </thead>
              <tbody>
                {changeOrders.flatMap((co) => {
                  const isEditable = co.status === 'draft' || co.status === 'revision_requested'
                  const expanded = expandedConseqId === co.id
                  const conseqLines = conseqCache[co.id] ?? []
                  return [
                  <tr
                    key={co.id}
                    className={`border-b border-border last:border-0 cursor-pointer hover:bg-muted/50 ${
                      co.status === 'revision_requested' ? 'bg-orange-50/40' : ''
                    }`}
                    onClick={
                      // Rad-klikk åpner EM-detaljsiden (lese-modus) for ALLE
                      // statuser. For redigerbare EM-er sender vi ?edit=1 så
                      // detaljsiden åpner redigerings-/revisjonsmodalen direkte.
                      () => router.push(
                        isEditable
                          ? `/subcontractor/change-orders/${co.id}?edit=1`
                          : `/subcontractor/change-orders/${co.id}`,
                      )
                    }
                  >
                    <td className="px-3 py-2 font-semibold tabular-nums text-[var(--color-text-secondary)]">
                      #{co.change_order_number}
                    </td>
                    <td className="px-3 py-2">
                      {(() => {
                        const t = changeOrderType(co.em_type)
                        return <span className={`text-xs px-2 py-0.5 rounded ${t.cls}`}>{t.label}</span>
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-[var(--color-text-primary)]">
                        {productNameMap.get(co.product_id) ?? '–'}
                      </div>
                      {/* Endret-/konsekvens-badges. Klikkbare så UE kan
                          se hva som er endret eller hvilke produkter som
                          trekkes hvis EMen avvises. Stopper propagation
                          så raden ikke åpner edit-modal samtidig. */}
                      {(co.has_admin_edits || co.has_consequence_lines) && (
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          {co.has_admin_edits && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openLatestEdit(co.id) }}
                              disabled={loadingDiff === co.id}
                              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors disabled:opacity-50"
                              title="Prosjektleder har redigert denne EM-en. Klikk for å se hva som er endret."
                            >
                              Endret av prosjektleder · Se endringer
                            </button>
                          )}
                          {co.has_consequence_lines && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleConsequence(co.id) }}
                              disabled={loadingConseq === co.id}
                              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors disabled:opacity-50"
                              title="Klikk for å se hva som trekkes fra prosjektet hvis EMen avvises."
                            >
                              Har konsekvens ved avslag {expanded ? '▲' : '▼'}
                            </button>
                          )}
                        </div>
                      )}
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
                      {/* 1.7 — «Sendt kunde» (blå) når admin har videresendt
                          EMen, ellers vanlig status-pille. Felles ordliste. */}
                      {(() => {
                        const sentToCustomer = co.status === 'pending' && !!co.sent_to_customer_at
                        const m = changeOrderPill(co.status, sentToCustomer)
                        return <StatusPill meta={m} />
                      })()}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)] whitespace-nowrap">
                      {co.submitted_at?.split('T')[0] ?? '–'}
                    </td>
                    <td className="px-3 py-2">
                      {co.status === 'rejected' && co.admin_comment ? (
                        <span className="text-xs text-danger">{co.admin_comment}</span>
                      ) : co.status === 'revision_requested' && co.admin_comment ? (
                        <span className="text-xs text-orange-700"><span className="font-semibold">Trenger revisjon: </span>{co.admin_comment}</span>
                      ) : co.status === 'revision_requested' ? (
                        <span className="text-xs text-orange-700 font-medium">Klikk for å rette opp</span>
                      ) : co.status === 'draft' ? (
                        <span className="text-xs text-primary">Klikk for å redigere</span>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">–</span>
                      )}
                    </td>
                  </tr>,
                  /* Ekspandert konsekvens-rad — rendres bare når UE har
                     klikket "Har konsekvens ved avslag"-badgen og data
                     er lastet. Read-only, ingen kundepris. */
                  expanded && (
                    <tr key={`${co.id}-conseq`} className="bg-orange-50/30">
                      <td colSpan={10} className="px-6 py-3">
                        <p className="text-xs font-semibold text-orange-900 mb-1">Konsekvens ved avslag</p>
                        <p className="text-xs text-orange-700 mb-2">
                          Dersom endringsmeldingen avslås, kan følgende trekkes ut eller ikke gjennomføres:
                        </p>
                        {conseqLines.length === 0 ? (
                          <p className="text-xs text-[var(--color-text-muted)] italic">Ingen konsekvens-linjer lagt inn.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-orange-700">
                                <th className="py-1 font-medium">Produkt</th>
                                <th className="py-1 font-medium text-right">Mengde</th>
                              </tr>
                            </thead>
                            <tbody>
                              {conseqLines.map((cl) => (
                                <tr key={cl.id}>
                                  <td className="py-1 text-[var(--color-text-primary)]">
                                    {productNameMap.get(cl.product_id) ?? cl.product_id}
                                  </td>
                                  <td className="py-1 text-right tabular-nums text-[var(--color-text-primary)]">
                                    − {cl.quantity} <span className="text-[var(--color-text-muted)]">{cl.unit}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </>
      )}

      {/* ═══ FANE: FAKTURERING (4.6) ══════════════════════════════════════════ */}
      {activeTab === 'fakturering' && (
      <>
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Fakturering</h2>
        </div>
        <div className="p-6 space-y-5">
          {/* Tre kost-tall (alle UE-egne, ingen kundepris): hva som er klart å
              fakturere, hva som alt er fakturert, og differansen. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-50 text-emerald-600 flex-none">
                  <Receipt size={16} />
                </div>
                <p className="text-xs font-medium text-[var(--color-text-primary)]">Klart til fakturering</p>
              </div>
              <p className={`text-xl font-bold ${readyToInvoiceValue < 0 ? 'text-danger' : 'text-[var(--color-text-primary)]'}`}>{fmt(readyToInvoiceValue)}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Godkjent + godkjente EM − fakturert</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-50 text-blue-600 flex-none">
                  <CheckCircle size={16} />
                </div>
                <p className="text-xs font-medium text-[var(--color-text-primary)]">Fakturert</p>
              </div>
              <p className="text-xl font-bold text-[var(--color-text-primary)]">{fmt(invoicedValue)}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Sum av dine registrerte fakturaer</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-50 text-green-600 flex-none">
                  <BarChart3 size={16} />
                </div>
                <p className="text-xs font-medium text-[var(--color-text-primary)]">Godkjent grunnlag</p>
              </div>
              <p className="text-xl font-bold text-[var(--color-text-primary)]">{fmt(totalApprovedValue + approvedEMValue)}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Godkjent arbeid + godkjente EM</p>
            </div>
          </div>

          <Link
            href={`/subcontractor/invoice-basis?project=${id}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Receipt size={15} />
            Åpne fakturagrunnlag for dette prosjektet
            <ChevronRight size={15} />
          </Link>

          <p className="text-xs text-[var(--color-text-muted)]">
            Fakturagrunnlaget viser godkjente linjer og endringsmeldinger linje-for-linje, og lar deg registrere
            fakturerte beløp.
          </p>
        </div>
      </Card>
      </>
      )}
    </div>
  )
}
