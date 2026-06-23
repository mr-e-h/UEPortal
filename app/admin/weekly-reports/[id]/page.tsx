'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { WeeklyReport, WeeklyReportLine, ActivityEntry } from '@/types'
import { formatWeekLabel } from '@/lib/utils/weeks'
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
  // Økonomivisning (salgsverdi) er forbeholdt main/company/PM. For byggeleder
  // er customer_price_snapshot uansett strippet server-side i
  // /api/weekly-reports/[id] — dette styrer bare at UI-et ikke viser
  // tomme/NaN-kolonner. Frontend-skjuling er UX; serveren er sikkerheten.
  const canSeeEconomy = me ? ADMIN_ROLES.includes(me.role) : true
  const [bulkComment, setBulkComment] = useState('')
  const [newComment, setNewComment] = useState('')
  const [saving, setSaving] = useState(false)

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

  // Andre innsendinger DENNE uken (utenom denne) — til seksjonen nederst.
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

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/admin/weekly-reports" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-sm mt-1">← Ukesrapporter</Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            {project?.name ?? '–'} — {formatWeekLabel(report.year, report.week_number)} — Innsending #{report.submission_number ?? 1}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {project?.project_number && `${project.project_number} · `}
            {sub?.company_name ?? '–'}
            {report.submitted_at && ` · Innsendt ${new Date(report.submitted_at).toLocaleDateString('nb-NO')}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(() => { const m = weeklyReportStatus(report.status); return <span className={`text-sm px-3 py-1 rounded ${m.cls}`}>{m.label}</span> })()}
          {isReviewed && (
            <button
              onClick={revert}
              disabled={saving}
              className="px-3 py-1 text-xs bg-muted text-[var(--color-text-secondary)] rounded hover:bg-gray-200 disabled:opacity-50"
            >
              Angre
            </button>
          )}
        </div>
      </div>

      {/* Summary cards — salgsverdi-kortet kun for økonomiroller.
          (Linjeantallet er synlig i tabellen — eget kort var bare støy.) */}
      <div className={`grid gap-4 ${canSeeEconomy ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <Card className="p-4">
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Total kostnad</p>
          <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{fmt(totalCost)}</p>
        </Card>
        {canSeeEconomy && (
          <Card className="p-4">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Total salgsverdi</p>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{fmt(totalSales)}</p>
          </Card>
        )}
      </div>

      {/* Bulk actions */}
      {report.status === 'submitted' && (
        <div className="bg-muted border border-border rounded-lg p-4 flex flex-wrap gap-4 items-end">
          <Field label="Kommentar (valgfri)" className="flex-1 min-w-48">
            <input
              type="text"
              value={bulkComment}
              onChange={(e) => setBulkComment(e.target.value)}
              placeholder="Melding til underentreprenør..."
              className="w-full px-3 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-blue-500"
            />
          </Field>
          <button
            onClick={() => bulkReview('approve_all')}
            disabled={saving}
            className="px-4 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
          >
            Godkjenn alle
          </button>
          <button
            onClick={() => bulkReview('reject_all')}
            disabled={saving}
            className="px-4 py-1.5 border border-red-300 text-red-700 text-sm rounded hover:bg-red-50 disabled:opacity-50"
          >
            Avslå alle
          </button>
        </div>
      )}

      {report.admin_comment && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800">
          Admin-kommentar: <span className="font-medium">{report.admin_comment}</span>
        </div>
      )}

      {/* Linjer — gruppert per produkt, med budsjett-kontekst så admin ser hva
          som skjer ved godkjenning: Budsjett (netto) · Godkjent før (andre
          rapporter) · Meldt inn (denne) · Etter godkj. (= budsjett − godkjent
          før − meldt inn; rødt + ⚠ = over budsjett). */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <SortableTable
          columns={[
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
          ]}
          data={groupRows}
          emptyText="Ingen linjer i denne rapporten"
        />
      </div>

      {/* Activity log + comments */}
      <Card className="p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Historikk</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Ingen handlinger ennå</p>
        ) : (
          <ol className="space-y-2">
            {activity.map((entry) => (
              <li key={entry.id} className="flex gap-3 text-sm">
                <span className="text-[var(--color-text-muted)] text-xs mt-0.5 whitespace-nowrap">
                  {new Date(entry.created_at).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
                <span>
                  <span className="font-medium text-[var(--color-text-primary)]">{entry.actor}</span>
                  {' '}
                  <span className="text-[var(--color-text-secondary)]">{activityActionLabel(entry.action)}</span>
                  {entry.comment && (
                    <span className="text-[var(--color-text-muted)]"> — &quot;{entry.comment}&quot;</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}

        {/* Comment input */}
        <form onSubmit={submitComment} className="flex gap-2 pt-2 border-t border-border">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Skriv en kommentar..."
            className="flex-1 px-3 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-blue-500"
          />
          <Button type="submit" disabled={!newComment.trim()}>
            Send
          </Button>
        </form>
      </Card>

      {/* Other submissions this week */}
      {siblings.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-3">Andre innsendinger denne uken</h2>
          {(() => {
            type SibRow = { id: string; submission_number: number; submitted_at: string; status: string; line_count: number; total_cost: number }
            const sibRows: SibRow[] = siblings.map((s) => ({
              id: s.id,
              submission_number: s.submission_number ?? 1,
              submitted_at: s.submitted_at ? new Date(s.submitted_at).toLocaleDateString('nb-NO') : '–',
              status: s.status,
              line_count: s.lines.length,
              total_cost: s.lines.reduce((acc, l) => {
                const bl = budgetLines.find((b) => b.id === l.project_budget_line_id)
                return acc + l.reported_quantity * (bl?.subcontractor_cost_price_snapshot ?? 0)
              }, 0),
            }))
            return (
              <div className="bg-white rounded-lg shadow">
                <SortableTable
                  columns={[
                    { key: 'submission_number', label: 'Innsending #', sortable: true, render: (r: SibRow) => `#${r.submission_number}` },
                    { key: 'submitted_at', label: 'Dato', sortable: true },
                    {
                      key: 'status',
                      label: 'Status',
                      sortable: true,
                      render: (r: SibRow) => {
                        const m = weeklyReportStatus(r.status)
                        return <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>
                      },
                    },
                    { key: 'line_count', label: 'Antall linjer', sortable: true },
                    { key: 'total_cost', label: 'Kostnad', sortable: true, getValue: (r: SibRow) => r.total_cost, render: (r: SibRow) => fmt(r.total_cost) },
                  ]}
                  data={sibRows}
                  emptyText="Ingen andre innsendinger"
                  onRowClick={(r: SibRow) => router.push(`/admin/weekly-reports/${r.id}`)}
                  rowClassName={() => 'border-b border-border hover:bg-blue-50 cursor-pointer'}
                />
              </div>
            )
          })()}
        </section>
      )}
    </main>
  )
}
