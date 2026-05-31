'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { WeeklyReport, WeeklyReportLine, ActivityEntry } from '@/types'
import { formatWeekLabel } from '@/lib/utils/weeks'
import SortableTable from '@/components/SortableTable'
import { fmtNOK as fmt } from '@/lib/format'
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
type BudgetLine = { id: string; subcontractor_cost_price_snapshot: number }

type Subcontractor = { id: string; company_name: string }
type Project = { id: string; name: string; project_number: string }

export default function AdminWeeklyReportPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [sub, setSub] = useState<Subcontractor | null>(null)
  const [siblings, setSiblings] = useState<SiblingReport[]>([])
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const { me } = useMe()
  const adminName = me?.full_name ?? 'Admin'
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

    const [siblingReports, bl, activityData] = await Promise.all([
      fetch(
        `/api/weekly-reports?project_id=${detail.project_id}&subcontractor_id=${detail.subcontractor_id}&year=${detail.year}&week_number=${detail.week_number}&with_lines=true`
      ).then((r) => r.json()) as Promise<SiblingReport[]>,
      fetch(`/api/budget-lines?project_id=${detail.project_id}`).then((r) => r.json()) as Promise<BudgetLine[]>,
      fetch(`/api/activity?entity_id=${id}&entity_type=weekly_report`).then((r) => r.json()) as Promise<ActivityEntry[]>,
    ])
    setSiblings(siblingReports.filter((r) => r.id !== id))
    setBudgetLines(bl)
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

  async function reviewLine(lineId: string, status: 'approved' | 'rejected') {
    await fetch(`/api/weekly-reports/${id}/lines/${lineId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewed_by: adminName }),
    })
    await load()
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

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Laster...</div>
  if (!report) return <div className="flex items-center justify-center h-64 text-gray-500">Rapport ikke funnet</div>

  const totalCost = report.lines.reduce((s, l) => s + l.reported_quantity * l.subcontractor_cost_price_snapshot, 0)
  const totalSales = report.lines.reduce((s, l) => s + l.reported_quantity * l.customer_price_snapshot, 0)

  type LineRow = EnrichedLine & { cost: number; sales: number }
  // Show ALL lines (including 0-qty) so admin can see what was submitted +
  // approve/reject the zero entries too. Previously zeros were hidden, which
  // caused the table count to mismatch the report's "Linjer: N" KPI.
  const lineRows: LineRow[] = report.lines.map((l) => ({
    ...l,
    cost: l.reported_quantity * l.subcontractor_cost_price_snapshot,
    sales: l.reported_quantity * l.customer_price_snapshot,
  }))

  const isReviewed = report.status === 'approved' || report.status === 'rejected'

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/admin" className="text-gray-400 hover:text-gray-600 text-sm mt-1">← Dashboard</Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">
            {project?.name ?? '–'} — {formatWeekLabel(report.year, report.week_number)} — Innsending #{report.submission_number ?? 1}
          </h1>
          <p className="text-sm text-gray-500">
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
              className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 disabled:opacity-50"
            >
              Angre
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Linjer</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{report.lines.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total kostnad</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(totalCost)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total salgsverdi</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(totalSales)}</p>
        </Card>
      </div>

      {/* Bulk actions */}
      {report.status === 'submitted' && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-wrap gap-4 items-end">
          <Field label="Kommentar (valgfri)" className="flex-1 min-w-48">
            <input
              type="text"
              value={bulkComment}
              onChange={(e) => setBulkComment(e.target.value)}
              placeholder="Melding til underentreprenør..."
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-blue-500"
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
            className="px-4 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
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

      {/* Lines table */}
      <div className="bg-white rounded-lg shadow">
        <SortableTable
          columns={[
            { key: 'product_name', label: 'Produkt', sortable: true },
            { key: 'unit', label: 'Enhet' },
            { key: 'reported_quantity', label: 'Mengde', sortable: true },
            { key: 'comment', label: 'Kommentar' },
            { key: 'cost', label: 'Kostnad', sortable: true, getValue: (r: LineRow) => r.cost, render: (r: LineRow) => fmt(r.cost) },
            { key: 'sales', label: 'Salgsverdi', sortable: true, getValue: (r: LineRow) => r.sales, render: (r: LineRow) => <span className="font-medium">{fmt(r.sales)}</span> },
            {
              key: 'status',
              label: 'Status',
              sortable: true,
              render: (r: LineRow) => {
                const m = weeklyReportLineStatus(r.status)
                return <span className={`text-xs px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>
              },
            },
            {
              key: 'actions',
              label: '',
              render: (r: LineRow) => r.status === 'pending' ? (
                <div className="flex gap-1.5">
                  <button onClick={() => reviewLine(r.id, 'approved')} className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700">Godkjenn</button>
                  <button onClick={() => reviewLine(r.id, 'rejected')} className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700">Avslå</button>
                </div>
              ) : null,
            },
          ]}
          data={lineRows}
          emptyText="Ingen linjer i denne rapporten"
        />
      </div>

      {/* Activity log + comments */}
      <Card className="p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Handlingslogg</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-gray-400">Ingen handlinger ennå</p>
        ) : (
          <ol className="space-y-2">
            {activity.map((entry) => (
              <li key={entry.id} className="flex gap-3 text-sm">
                <span className="text-gray-400 text-xs mt-0.5 whitespace-nowrap">
                  {new Date(entry.created_at).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
                <span>
                  <span className="font-medium text-gray-800">{entry.actor}</span>
                  {' '}
                  <span className="text-gray-600">{activityActionLabel(entry.action)}</span>
                  {entry.comment && (
                    <span className="text-gray-500"> — &quot;{entry.comment}&quot;</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}

        {/* Comment input */}
        <form onSubmit={submitComment} className="flex gap-2 pt-2 border-t border-gray-100">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Skriv en kommentar..."
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-blue-500"
          />
          <Button type="submit" disabled={!newComment.trim()}>
            Send
          </Button>
        </form>
      </Card>

      {/* Other submissions this week */}
      {siblings.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-3">Andre innsendinger denne uken</h2>
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
                    { key: 'total_cost', label: 'Verdi', sortable: true, getValue: (r: SibRow) => r.total_cost, render: (r: SibRow) => fmt(r.total_cost) },
                  ]}
                  data={sibRows}
                  emptyText="Ingen andre innsendinger"
                  onRowClick={(r: SibRow) => router.push(`/admin/weekly-reports/${r.id}`)}
                  rowClassName={() => 'border-b border-gray-100 hover:bg-blue-50 cursor-pointer'}
                />
              </div>
            )
          })()}
        </section>
      )}
    </main>
  )
}
