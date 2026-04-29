'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Save, ArrowLeft, CalendarDays } from 'lucide-react'
import type { Project, ProjectMonthPlan } from '@/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des']

function fmtKr(n: number) {
  if (n === 0) return ''
  return new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(n)
}

function num(v: string): number {
  const n = parseFloat(v.replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function buildMonthGrid(startDate: string, endDate: string): { year: number; month: number }[] {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const result: { year: number; month: number }[] = []
  let cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= last) {
    result.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 })
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  }
  return result
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('nb-NO', { month: 'short', year: 'numeric' })
}

type Row = Omit<ProjectMonthPlan, 'id' | 'updated_at'>

const EMPTY_ROW = (year: number, month: number, projectId: string): Row => ({
  project_id: projectId,
  year,
  month,
  expected_revenue: 0,
  internal_hours: 0,
  internal_cost: 0,
  ue_hours: 0,
  ue_cost: 0,
  other_cost: 0,
  risk: 0,
  comment: '',
})

// ─── Column definitions ───────────────────────────────────────────────────────

type ColKey = 'expected_revenue' | 'internal_hours' | 'internal_cost' | 'ue_hours' | 'ue_cost' | 'other_cost' | 'risk' | 'comment'

const COLS: { key: ColKey; label: string; unit: 'kr' | 'timer' | 'text'; width: string }[] = [
  { key: 'expected_revenue', label: 'Forventet omsetning', unit: 'kr', width: 'w-32' },
  { key: 'internal_hours', label: 'Interne timer', unit: 'timer', width: 'w-24' },
  { key: 'internal_cost', label: 'Intern kostnad', unit: 'kr', width: 'w-28' },
  { key: 'ue_hours', label: 'UE-timer', unit: 'timer', width: 'w-24' },
  { key: 'ue_cost', label: 'UE-kostnad', unit: 'kr', width: 'w-28' },
  { key: 'other_cost', label: 'Annen kostnad', unit: 'kr', width: 'w-28' },
  { key: 'risk', label: 'Risiko', unit: 'kr', width: 'w-24' },
  { key: 'comment', label: 'Kommentar', unit: 'text', width: 'w-40' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function MonthlyPlanPage() {
  const { id } = useParams<{ id: string }>()

  const [project, setProject] = useState<Project | null>(null)
  const [monthGrid, setMonthGrid] = useState<{ year: number; month: number }[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    const [projects, plans]: [Project[], ProjectMonthPlan[]] = await Promise.all([
      fetch('/api/projects').then((r) => r.json()),
      fetch(`/api/project-month-plans?project_id=${id}`).then((r) => r.json()),
    ])

    const proj = projects.find((p) => p.id === id) ?? null
    setProject(proj)

    if (!proj?.start_date || !proj?.end_date) {
      setLoading(false)
      return
    }

    const grid = buildMonthGrid(proj.start_date, proj.end_date)
    setMonthGrid(grid)

    const planMap = new Map(plans.map((p) => [`${p.year}-${p.month}`, p]))
    const initialRows: Row[] = grid.map(({ year, month }) => {
      const existing = planMap.get(`${year}-${month}`)
      if (existing) {
        const { id: _id, updated_at: _u, ...rest } = existing
        return rest
      }
      return EMPTY_ROW(year, month, id)
    })

    setRows(initialRows)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  function updateCell(rowIdx: number, key: ColKey, rawValue: string) {
    setRows((prev) => {
      const next = [...prev]
      const row = { ...next[rowIdx] }
      if (key === 'comment') {
        row[key] = rawValue
      } else {
        ;(row as Record<string, number | string>)[key] = num(rawValue)
      }
      next[rowIdx] = row
      return next
    })
    setDirty(true)
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    const nonEmpty = rows.filter(
      (r) =>
        r.expected_revenue || r.internal_hours || r.internal_cost ||
        r.ue_hours || r.ue_cost || r.other_cost || r.risk || r.comment
    )
    await fetch('/api/project-month-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: id, rows: nonEmpty }),
    })
    setSaving(false)
    setDirty(false)
    setSaved(true)
  }

  // ─── Totals ────────────────────────────────────────────────────────────────

  const totals = rows.reduce(
    (acc, r) => ({
      expected_revenue: acc.expected_revenue + r.expected_revenue,
      internal_hours: acc.internal_hours + r.internal_hours,
      internal_cost: acc.internal_cost + r.internal_cost,
      ue_hours: acc.ue_hours + r.ue_hours,
      ue_cost: acc.ue_cost + r.ue_cost,
      other_cost: acc.other_cost + r.other_cost,
      risk: acc.risk + r.risk,
    }),
    { expected_revenue: 0, internal_hours: 0, internal_cost: 0, ue_hours: 0, ue_cost: 0, other_cost: 0, risk: 0 }
  )

  const totalCost = rows.reduce((s, r) => s + r.internal_cost + r.ue_cost + r.other_cost + r.risk, 0)
  const totalProfit = totals.expected_revenue - totalCost

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-sm text-[var(--color-text-muted)]">Laster...</div>
  }

  // Gate: require start_date and end_date
  if (!project?.start_date || !project?.end_date) {
    return (
      <div className="p-6 space-y-5">
        <div>
          <Link href={`/admin/projects/${id}`} className="text-xs text-[var(--color-text-muted)] hover:underline flex items-center gap-1 mb-1">
            <ArrowLeft size={12} /> {project?.name ?? 'Prosjekt'}
          </Link>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Månedlig kostnadsplan</h1>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 flex flex-col items-center gap-3 text-center max-w-md mx-auto mt-12">
          <CalendarDays size={32} className="text-amber-500" />
          <p className="font-semibold text-amber-900">Startdato og sluttdato mangler</p>
          <p className="text-sm text-amber-700">
            For å redigere den månedlige kostnadsplanen må prosjektet ha en <strong>startdato</strong> og en <strong>sluttdato</strong>.
            Prognosen vil da dekke alle måneder mellom disse datoene.
          </p>
          <Link
            href={`/admin/projects/${id}/edit`}
            className="mt-1 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
          >
            Gå til prosjektinnstillinger
          </Link>
        </div>
      </div>
    )
  }

  const now = new Date()

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/admin/projects/${id}`} className="text-xs text-[var(--color-text-muted)] hover:underline flex items-center gap-1 mb-1">
            <ArrowLeft size={12} /> {project.name}
          </Link>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Månedlig kostnadsplan</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            {project.project_number} · {project.customer} · {formatDate(project.start_date)} – {formatDate(project.end_date)} · {monthGrid.length} måneder
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
        >
          <Save size={14} />
          {saving ? 'Lagrer...' : saved && !dirty ? 'Lagret ✓' : 'Lagre'}
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total omsetning', value: totals.expected_revenue, cls: 'text-blue-700' },
          { label: 'Total kostnad', value: totalCost, cls: '' },
          { label: 'Interne timer', value: totals.internal_hours, unit: 'timer', cls: '' },
          { label: 'UE-timer', value: totals.ue_hours, unit: 'timer', cls: '' },
          { label: 'Internkostnad', value: totals.internal_cost, cls: '' },
          { label: 'UE-kostnad', value: totals.ue_cost, cls: '' },
          { label: 'Risiko', value: totals.risk, cls: 'text-amber-600' },
          { label: 'Forventet fortjeneste', value: totalProfit, cls: totalProfit >= 0 ? 'text-green-600' : 'text-red-600' },
        ].map(({ label, value, cls, unit }) => (
          <div key={label} className="bg-card border border-border rounded-lg p-3">
            <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
            <p className={`text-sm font-semibold mt-0.5 ${cls || 'text-[var(--color-text-primary)]'}`}>
              {unit === 'timer'
                ? `${new Intl.NumberFormat('nb-NO').format(value)} t`
                : new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(value)}
            </p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted border-b border-border">
                <th className="sticky left-0 z-10 bg-muted px-4 py-3 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide w-24">
                  Måned
                </th>
                {COLS.map((col) => (
                  <th key={col.key} className={`px-3 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide ${col.width}`}>
                    <div>{col.label}</div>
                    <div className="text-[10px] font-normal normal-case text-[var(--color-text-muted)]/60 mt-0.5">{col.unit}</div>
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide w-28">
                  Fortjeneste
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const { year, month } = monthGrid[idx]
                const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
                const isNewYear = month === 1 && idx > 0
                const rowProfit = row.expected_revenue - row.internal_cost - row.ue_cost - row.other_cost - row.risk
                const hasData = row.expected_revenue || row.internal_hours || row.internal_cost ||
                  row.ue_hours || row.ue_cost || row.other_cost || row.risk || row.comment

                return (
                  <>
                    {isNewYear && (
                      <tr key={`year-${year}`} className="bg-muted/60">
                        <td colSpan={COLS.length + 2} className="px-4 py-1.5 text-xs font-bold text-[var(--color-text-muted)] tracking-widest uppercase">
                          {year}
                        </td>
                      </tr>
                    )}
                    <tr
                      key={`${year}-${month}`}
                      className={`border-b border-border transition-colors ${
                        isCurrentMonth ? 'bg-blue-50/50' : hasData ? 'bg-card' : 'hover:bg-muted/40'
                      }`}
                    >
                      <td className="sticky left-0 z-10 px-4 py-2 font-medium text-[var(--color-text-secondary)] bg-inherit whitespace-nowrap">
                        {MONTH_NAMES[month]} {year !== now.getFullYear() ? '' : ''}{isCurrentMonth && (
                          <span className="ml-1 text-[10px] bg-primary text-white px-1 py-0.5 rounded">nå</span>
                        )}
                      </td>
                      {COLS.map((col) => (
                        <td key={col.key} className="px-2 py-1.5">
                          <input
                            type={col.unit === 'text' ? 'text' : 'number'}
                            step={col.unit === 'timer' ? '0.5' : '1000'}
                            value={col.unit === 'text'
                              ? (row[col.key] as string)
                              : ((row[col.key] as number) || '')}
                            onChange={(e) => updateCell(idx, col.key, e.target.value)}
                            placeholder="–"
                            className={`${col.width} px-2 py-1 text-xs border border-transparent rounded bg-transparent hover:border-border focus:border-primary focus:bg-card focus:outline-none focus:ring-0 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]/40 transition-colors`}
                          />
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right text-xs font-medium whitespace-nowrap">
                        {hasData ? (
                          <span className={rowProfit >= 0 ? 'text-green-600' : 'text-red-500'}>
                            {new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(rowProfit)}
                          </span>
                        ) : (
                          <span className="text-[var(--color-text-muted)]/30">–</span>
                        )}
                      </td>
                    </tr>
                  </>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted font-semibold">
                <td className="sticky left-0 z-10 px-4 py-3 text-xs uppercase tracking-wide text-[var(--color-text-muted)] bg-muted">
                  Total
                </td>
                {COLS.map((col) => {
                  if (col.key === 'comment') return <td key={col.key} />
                  const val = totals[col.key as keyof typeof totals]
                  return (
                    <td key={col.key} className="px-3 py-3 text-xs text-[var(--color-text-primary)]">
                      {col.unit === 'timer'
                        ? `${new Intl.NumberFormat('nb-NO').format(val)} t`
                        : new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(val)}
                    </td>
                  )
                })}
                <td className={`px-4 py-3 text-right text-xs font-bold ${totalProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(totalProfit)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {dirty && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? 'Lagrer...' : 'Lagre endringer'}
          </button>
        </div>
      )}
    </div>
  )
}
