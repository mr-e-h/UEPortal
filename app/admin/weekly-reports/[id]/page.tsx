'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { WeeklyReport, WeeklyReportLine, ActivityEntry } from '@/types'
import { getWeekDateRange } from '@/lib/utils/weeks'
import { calculateBudgetUsage, type LineWithReportStatus } from '@/lib/utils/budgetUsage'
import SortableTable from '@/components/SortableTable'
import { fmtNOK as fmt } from '@/lib/format'
import { ADMIN_ROLES } from '@/lib/roles'
import { weeklyReportStatus, weeklyReportLineStatus } from '@/lib/statuses'
import { activityActionLabel } from '@/lib/activity-actions'
import { useMe } from '@/lib/useMe'
import Field from '@/components/ui/Field'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { Database, BarChart3, Percent, Clock, History, MessageSquare } from 'lucide-react'

type EnrichedLine = WeeklyReportLine & {
  product_name: string
  product_description: string
  unit: string
  customer_price_snapshot: number
  subcontractor_cost_price_snapshot: number
}

type ReportDetail = WeeklyReport & { lines: EnrichedLine[] }
type SiblingReport = WeeklyReport & { lines: WeeklyReportLine[] }
type BudgetLine = { id: string; budget_quantity: number; subcontractor_cost_price_snapshot: number }

type Subcontractor = { id: string; company_name: string }
type Project = { id: string; name: string; project_number: string }

export default function AdminWeeklyReportPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [sub, setSub] = useState<Subcontractor | null>(null)
  // Alle innsendinger for dette prosjekt+UE (alle uker) — brukes både til
  // «andre innsendinger denne uken» OG til «allerede godkjent»-konteksten.
  const [allSubReports, setAllSubReports] = useState<SiblingReport[]>([])
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const { me } = useMe()
  const adminName = me?.full_name ?? 'Admin'
  // Økonomivisning (salgsverdi/dekningsbidrag) er forbeholdt main/company/PM.
  // For byggeleder er customer_price_snapshot uansett strippet server-side i
  // /api/weekly-reports/[id] — dette styrer bare at UI-et ikke viser
  // tomme/NaN-kolonner. Frontend-skjuling er UX; serveren er sikkerheten.
  const canSeeEconomy = me ? ADMIN_ROLES.includes(me.role) : true
  const [bulkComment, setBulkComment] = useState('')
  const [newComment, setNewComment] = useState('')
  const [saving, setSaving] = useState(false)
  // Godkjenningspanel-filtre + «vis alle hendelser».
  const [tableSearch, setTableSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [onlyDeviations, setOnlyDeviations] = useState(false)
  const [showAllActivity, setShowAllActivity] = useState(false)

  const load = useCallback(async () => {
    const [detail, projs, subs] = await Promise.all([
      fetch(`/api/weekly-reports/${id}`).then((r) => r.json()) as Promise<ReportDetail>,
      fetch('/api/projects').then((r) => r.json()) as Promise<Project[]>,
      fetch('/api/subcontractors').then((r) => r.json()) as Promise<Subcontractor[]>,
    ])
    setReport(detail)
    setProject(projs.find((p) => p.id === detail.project_id) ?? null)
    setSub(subs.find((s) => s.id === detail.subcontractor_id) ?? null)

    const [allReports, bl, activityData] = await Promise.all([
      fetch(
        `/api/weekly-reports?project_id=${detail.project_id}&subcontractor_id=${detail.subcontractor_id}&with_lines=true`
      ).then((r) => r.json()) as Promise<SiblingReport[]>,
      fetch(`/api/budget-lines?project_id=${detail.project_id}`).then((r) => r.json()) as Promise<BudgetLine[]>,
      fetch(`/api/activity?entity_id=${id}&entity_type=weekly_report`).then((r) => r.json()) as Promise<ActivityEntry[]>,
    ])
    setAllSubReports(Array.isArray(allReports) ? allReports : [])
    setBudgetLines(Array.isArray(bl) ? bl : [])
    setActivity(Array.isArray(activityData) ? activityData : [])

    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  async function bulkReview(action: 'approve_all' | 'reject_all') {
    setSaving(true)
    await fetch(`/api/weekly-reports/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, admin_comment: bulkComment || undefined, reviewed_by: adminName }),
    })
    await load()
    setBulkComment('')
    setSaving(false)
  }

  async function revert() {
    setSaving(true)
    await fetch(`/api/weekly-reports/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revert', reviewed_by: adminName }),
    })
    await load()
    setSaving(false)
  }

  // Godkjenn/avslå alle (pending) linjene i en produktgruppe på én gang — UE
  // rapporterer per produkt, så admin behandler per produkt.
  async function reviewGroup(lineIds: string[], status: 'approved' | 'rejected') {
    if (lineIds.length === 0) return
    setSaving(true)
    await Promise.all(lineIds.map((lid) =>
      fetch(`/api/weekly-reports/${id}/lines/${lid}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reviewed_by: adminName }),
      }),
    ))
    await load()
    setSaving(false)
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault()
    if (!newComment.trim()) return
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_type: 'weekly_report',
        entity_id: id,
        action: 'commented',
        actor: adminName,
        comment: newComment.trim(),
      }),
    })
    setNewComment('')
    await load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Laster...</div>
  if (!report) return <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Rapport ikke funnet</div>

  const totalCost = report.lines.reduce((s, l) => s + l.reported_quantity * l.subcontractor_cost_price_snapshot, 0)
  const totalSales = report.lines.reduce((s, l) => s + l.reported_quantity * l.customer_price_snapshot, 0)
  const nb = (n: number) => n.toLocaleString('nb-NO', { maximumFractionDigits: 2 })

  // Andre innsendinger DENNE uken (utenom denne).
  const siblings = allSubReports.filter(
    (r) => r.id !== id && r.year === report.year && r.week_number === report.week_number,
  )

  // Alle rapportlinjer på tvers av uker (med rapport-status) — for «allerede
  // godkjent» per budsjettlinje (ekskl. denne rapporten).
  const usageLines: LineWithReportStatus[] = allSubReports.flatMap((r) =>
    r.lines.map((l) => ({ ...l, report_status: r.status })),
  )
  const blById = new Map(budgetLines.map((b) => [b.id, b]))

  // Grupper DENNE rapportens linjer per produkt (product_name) — UE rapporterer
  // per produkt; et produkt kan ha flere budsjettlinjer (prisperioder/korreksjoner).
  // Budsjett-kontekst: Budsjett (netto Σ) · Godkjent før (andre rapporter) ·
  // Meldt inn (denne) · Etter godkj. (= budsjett − godkjent før − meldt inn).
  type GroupRow = {
    id: string; product_name: string; unit: string; comment: string
    lineIds: string[]; pendingLineIds: string[]
    reportedNow: number; budget: number; alreadyApproved: number; afterRemaining: number
    cost: number; sales: number; status: string
  }
  const groupMap = new Map<string, EnrichedLine[]>()
  for (const l of report.lines) {
    const arr = groupMap.get(l.product_name) ?? []
    arr.push(l)
    groupMap.set(l.product_name, arr)
  }
  const groupRows: GroupRow[] = Array.from(groupMap.values()).map((lines) => {
    const first = lines[0]
    const blIds = lines.map((l) => l.project_budget_line_id)
    const reportedNow = lines.reduce((s, l) => s + l.reported_quantity, 0)
    const budget = blIds.reduce((s, blId) => s + (blById.get(blId)?.budget_quantity ?? 0), 0)
    const alreadyApproved = blIds.reduce(
      (s, blId) => s + calculateBudgetUsage(blId, blById.get(blId)?.budget_quantity ?? 0, usageLines, report.id).approved,
      0,
    )
    const status = lines.every((l) => l.status === 'approved')
      ? 'approved'
      : lines.every((l) => l.status === 'rejected')
        ? 'rejected'
        : lines.some((l) => l.status === 'pending')
          ? 'pending'
          : first.status
    return {
      id: first.product_name,
      product_name: first.product_name,
      unit: first.unit,
      comment: lines.map((l) => l.comment).filter(Boolean).join(' · '),
      lineIds: lines.map((l) => l.id),
      pendingLineIds: lines.filter((l) => l.status === 'pending').map((l) => l.id),
      reportedNow,
      budget,
      alreadyApproved,
      afterRemaining: budget - alreadyApproved - reportedNow,
      cost: lines.reduce((s, l) => s + l.reported_quantity * l.subcontractor_cost_price_snapshot, 0),
      sales: lines.reduce((s, l) => s + l.reported_quantity * l.customer_price_snapshot, 0),
      status,
    }
  })

  const isReviewed = report.status === 'approved' || report.status === 'rejected'

  const dekningsbidrag = totalSales - totalCost
  const dbPct = totalSales > 0 ? (dekningsbidrag / totalSales) * 100 : 0
  const pendingCount = groupRows.filter((g) => g.pendingLineIds.length > 0).length

  // Tabell-filtre fra godkjenningspanelet: søk på produkt, status og «kun avvik»
  // (avvik = over budsjett ved godkjenning → afterRemaining < 0).
  const q = tableSearch.trim().toLowerCase()
  const filteredRows = groupRows.filter((g) =>
    (statusFilter === 'all' || g.status === statusFilter) &&
    (!onlyDeviations || g.afterRemaining < 0) &&
    (q === '' || g.product_name.toLowerCase().includes(q)),
  )

  const comments = activity.filter((e) => e.action === 'commented' && e.comment)
  const events = [...activity].reverse() // nyeste hendelse først
  const initials = (name: string) => name.split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase()

  const { start: weekStart, end: weekEnd } = getWeekDateRange(report.year, report.week_number)
  const dRange = (d: Date) => d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long' })
  const weekLabel = `Uke ${report.week_number} (${dRange(weekStart)} – ${dRange(weekEnd)})`

  const kpiCards: Array<{ icon: typeof Database; label: string; value: string; suffix?: string; color: string }> = [
    { icon: Database, label: 'Total kostnad', value: fmt(totalCost), color: 'text-slate-600 bg-slate-100' },
    ...(canSeeEconomy ? [
      { icon: BarChart3, label: 'Total salgsverdi', value: fmt(totalSales), color: 'text-indigo-600 bg-indigo-50' },
      { icon: Percent, label: 'Dekningsbidrag', value: fmt(dekningsbidrag), suffix: `(${dbPct.toLocaleString('nb-NO', { maximumFractionDigits: 1 })} %)`, color: 'text-green-600 bg-green-50' },
    ] : []),
    { icon: Clock, label: 'Linjer venter', value: `${pendingCount}`, suffix: pendingCount === 1 ? 'linje' : 'linjer', color: 'text-amber-600 bg-amber-50' },
  ]

  // Budsjett-kontekst-kolonner (delt mellom render). Slank tetthet beholdes via
  // SortableTable; vi rører ikke radhøyden her.
  const columns = [
    {
      key: 'product_name', label: 'Produkt', sortable: true,
      render: (r: GroupRow) => (
        <div>
          <div className="font-medium text-[var(--color-text-primary)]">{r.product_name}</div>
          {r.comment && <div className="text-xs text-[var(--color-text-muted)]">{r.comment}</div>}
        </div>
      ),
    },
    { key: 'unit', label: 'Enhet' },
    { key: 'budget', label: 'Budsjett', sortable: true, getValue: (r: GroupRow) => r.budget, render: (r: GroupRow) => <span className="tabular-nums text-[var(--color-text-secondary)]">{nb(r.budget)}</span> },
    { key: 'alreadyApproved', label: 'Godkjent før', sortable: true, getValue: (r: GroupRow) => r.alreadyApproved, render: (r: GroupRow) => <span className="tabular-nums text-[var(--color-text-secondary)]">{nb(r.alreadyApproved)}</span> },
    { key: 'reportedNow', label: 'Meldt inn', sortable: true, getValue: (r: GroupRow) => r.reportedNow, render: (r: GroupRow) => <span className="tabular-nums font-medium text-[var(--color-text-primary)]">{nb(r.reportedNow)}</span> },
    {
      key: 'afterRemaining', label: 'Etter godkj.', sortable: true,
      getValue: (r: GroupRow) => r.afterRemaining,
      render: (r: GroupRow) => (
        <span
          className={`tabular-nums font-medium ${r.afterRemaining < 0 ? 'text-danger' : 'text-[var(--color-text-primary)]'}`}
          title="Budsjett − godkjent før − meldt inn. Negativt = over budsjett ved godkjenning."
        >
          {nb(r.afterRemaining)}{r.afterRemaining < 0 ? ' ⚠' : ''}
        </span>
      ),
    },
    { key: 'cost', label: 'Kostnad', sortable: true, getValue: (r: GroupRow) => r.cost, render: (r: GroupRow) => fmt(r.cost) },
    ...(canSeeEconomy
      ? [{ key: 'sales', label: 'Salgsverdi', sortable: true, getValue: (r: GroupRow) => r.sales, render: (r: GroupRow) => <span className="font-medium">{fmt(r.sales)}</span> }]
      : []),
    {
      key: 'status', label: 'Status', sortable: true,
      render: (r: GroupRow) => {
        const m = weeklyReportLineStatus(r.status)
        return <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>
      },
    },
    {
      key: 'actions', label: '',
      render: (r: GroupRow) => r.pendingLineIds.length > 0 ? (
        <div className="flex gap-1.5">
          <button onClick={() => reviewGroup(r.pendingLineIds, 'approved')} disabled={saving} className="px-2 py-1 border border-green-300 text-green-700 text-xs rounded hover:bg-green-50 disabled:opacity-50">Godkjenn</button>
          <button onClick={() => reviewGroup(r.pendingLineIds, 'rejected')} disabled={saving} className="px-2 py-1 border border-red-300 text-red-700 text-xs rounded hover:bg-red-50 disabled:opacity-50">Avslå</button>
        </div>
      ) : null,
    },
  ]

  return (
    <main className="px-4 sm:px-6 py-6 space-y-5">
      {/* Header */}
      <div>
        <Link href="/admin/weekly-reports" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-sm">← Ukerapporter</Link>
        <div className="mt-2 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
              {project?.name ?? '–'} — {weekLabel} — Innsending #{report.submission_number ?? 1}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>Prosjekt: {project?.project_number ? `${project.project_number} · ` : ''}{sub?.company_name ?? '–'}</span>
              {report.submitted_at && <span>· Sendt inn: {new Date(report.submitted_at).toLocaleDateString('nb-NO')}</span>}
              {(() => { const m = weeklyReportStatus(report.status); return <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span> })()}
            </p>
          </div>
          {isReviewed && (
            <button
              onClick={revert}
              disabled={saving}
              className="px-3 py-1.5 text-xs bg-muted text-[var(--color-text-secondary)] rounded hover:bg-gray-200 disabled:opacity-50"
            >
              Angre vurdering
            </button>
          )}
        </div>
      </div>

      {/* KPI-kort — salgsverdi + dekningsbidrag kun for økonomiroller. */}
      <div className={`grid gap-4 grid-cols-2 ${canSeeEconomy ? 'lg:grid-cols-4' : 'sm:grid-cols-2'}`}>
        {kpiCards.map((c) => {
          const Icon = c.icon
          return (
            <Card key={c.label} className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-none ${c.color}`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">{c.label}</p>
                <p className="text-xl font-bold text-[var(--color-text-primary)] mt-0.5 truncate">
                  {c.value}{c.suffix && <span className="text-sm font-medium text-[var(--color-text-muted)] ml-1">{c.suffix}</span>}
                </p>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Hovedinnhold (godkjenning + tabell) + sidekolonne (hendelser + kommentarer) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* ── Venstre: godkjenning + tabell ── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Godkjenningspanel: bulk-handlinger (kun ved innsendt) + tabellfiltre */}
          <Card className="p-4 space-y-3">
            {report.status === 'submitted' && (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Kommentar til underentreprenør" className="flex-1 min-w-[12rem]">
                  <input
                    type="text"
                    value={bulkComment}
                    onChange={(e) => setBulkComment(e.target.value)}
                    placeholder="Melding til underentreprenør..."
                    className="w-full px-3 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </Field>
                <button onClick={() => bulkReview('approve_all')} disabled={saving} className="px-4 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50">Godkjenn alle</button>
                <button onClick={() => bulkReview('reject_all')} disabled={saving} className="px-4 py-1.5 border border-red-300 text-red-700 text-sm rounded hover:bg-red-50 disabled:opacity-50">Avslå alle</button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Søk i produkter…"
                className="px-3 py-1.5 text-sm border border-border rounded w-full sm:w-56 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'pending' | 'approved' | 'rejected')}
                className="px-3 py-1.5 text-sm border border-border rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">Status: Alle</option>
                <option value="pending">Venter</option>
                <option value="approved">Godkjent</option>
                <option value="rejected">Avslått</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer select-none sm:ml-1">
                <input type="checkbox" checked={onlyDeviations} onChange={(e) => setOnlyDeviations(e.target.checked)} className="rounded border-border" />
                Vis kun avvik
              </label>
            </div>
          </Card>

          {report.admin_comment && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800">
              Admin-kommentar: <span className="font-medium">{report.admin_comment}</span>
            </div>
          )}

          {/* Tabell — gruppert per produkt med budsjett-kontekst. Slank tetthet. */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <SortableTable columns={columns} data={filteredRows} emptyText="Ingen linjer matcher filteret" />
            </div>
            <div className="px-3 py-2 border-t border-border text-xs text-[var(--color-text-muted)]">
              Viser {filteredRows.length} av {groupRows.length} {groupRows.length === 1 ? 'linje' : 'linjer'}
            </div>
          </Card>

          {/* Andre innsendinger denne uken */}
          {siblings.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Andre innsendinger denne uken</h2>
              </div>
              <div className="overflow-x-auto">
                <SortableTable
                  columns={[
                    { key: 'submission_number', label: 'Innsending #', sortable: true, render: (r: { submission_number: number }) => `#${r.submission_number}` },
                    { key: 'submitted_at', label: 'Dato', sortable: true },
                    {
                      key: 'status', label: 'Status', sortable: true,
                      render: (r: { status: string }) => {
                        const m = weeklyReportStatus(r.status)
                        return <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>
                      },
                    },
                    { key: 'line_count', label: 'Antall linjer', sortable: true },
                    { key: 'total_cost', label: 'Kostnad', sortable: true, getValue: (r: { total_cost: number }) => r.total_cost, render: (r: { total_cost: number }) => fmt(r.total_cost) },
                  ]}
                  data={siblings.map((s) => ({
                    id: s.id,
                    submission_number: s.submission_number ?? 1,
                    submitted_at: s.submitted_at ? new Date(s.submitted_at).toLocaleDateString('nb-NO') : '–',
                    status: s.status,
                    line_count: s.lines.length,
                    total_cost: s.lines.reduce((acc, l) => {
                      const bl = blById.get(l.project_budget_line_id)
                      return acc + l.reported_quantity * (bl?.subcontractor_cost_price_snapshot ?? 0)
                    }, 0),
                  }))}
                  emptyText="Ingen andre innsendinger"
                  onRowClick={(r) => router.push(`/admin/weekly-reports/${r.id}`)}
                  rowClassName={() => 'border-b border-border hover:bg-blue-50 cursor-pointer'}
                />
              </div>
            </Card>
          )}
        </div>

        {/* ── Høyre: hendelser + kommentarer ── */}
        <div className="space-y-4">
          {/* Hendelser / Historikk */}
          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] mb-3">
              <History size={15} className="text-[var(--color-text-muted)]" /> Hendelser / Historikk
            </h2>
            {events.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">Ingen handlinger ennå</p>
            ) : (
              <>
                <ol className="space-y-3">
                  {(showAllActivity ? events : events.slice(0, 6)).map((entry) => (
                    <li key={entry.id} className="flex gap-2.5">
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 flex-none" />
                      <div className="leading-tight">
                        <div className="text-sm">
                          <span className="font-medium text-[var(--color-text-primary)]">{entry.actor}</span>{' '}
                          <span className="text-[var(--color-text-secondary)]">{activityActionLabel(entry.action)}</span>
                        </div>
                        <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                          {new Date(entry.created_at).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
                {events.length > 6 && (
                  <button
                    onClick={() => setShowAllActivity((v) => !v)}
                    className="mt-3 w-full text-center text-xs text-blue-600 hover:text-blue-700 border border-border rounded py-1.5 hover:bg-muted transition-colors"
                  >
                    {showAllActivity ? 'Vis færre' : 'Vis alle hendelser'}
                  </button>
                )}
              </>
            )}
          </Card>

          {/* Kommentarer */}
          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)] mb-3">
              <MessageSquare size={15} className="text-[var(--color-text-muted)]" /> Kommentarer
            </h2>
            {comments.length > 0 && (
              <ol className="space-y-3 mb-3">
                {comments.map((c) => (
                  <li key={c.id} className="flex gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-[11px] font-semibold flex items-center justify-center flex-none">{initials(c.actor)}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text-primary)]">{c.actor}</div>
                      <div className="text-sm text-[var(--color-text-secondary)] break-words">{c.comment}</div>
                      <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{new Date(c.created_at).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <form onSubmit={submitComment} className="flex gap-2 pt-2 border-t border-border">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Skriv en kommentar…"
                className="flex-1 px-3 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <Button type="submit" disabled={!newComment.trim()}>Send</Button>
            </form>
          </Card>
        </div>
      </div>
    </main>
  )
}
