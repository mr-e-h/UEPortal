'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle, RotateCcw, Lock, Unlock, Save } from 'lucide-react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import NumberInput from '@/components/NumberInput'
import { MONTHS_SHORT as MONTH_NAMES, fmtNOK as fmt } from '@/lib/format'
import { forecastStatus } from '@/lib/statuses'
import { useMe } from '@/lib/useMe'
import ForecastTabs from '../ForecastTabs'
import type {
  Project,
  ProjectBudgetLine,
  ProjectInvoice,
  ForecastPeriod,
  ProjectForecast,
  ProjectForecastMonth,
  ForecastStatus,
} from '@/types'

// ─── Types ───────────────────────────────────────────────────────────────────

type MonthData = {
  month: number
  year: number
  expected_revenue: number
  expected_ue_cost: number
  expected_internal_cost: number
  expected_other_cost: number
  risk_amount: number
  comment: string
}

type ForecastEntry = {
  projectId: string
  forecastId: string | null
  projectName: string
  projectNumber: string
  customer: string
  totalSales: number
  invoiced: number
  remaining: number
  expectedRevenue: number
  expectedUeCost: number
  expectedInternalCost: number
  expectedOtherCost: number
  riskAmount: number
  comment: string
  status: ForecastStatus
  submittedAt: string | null
  approvedBy: string | null
  returnedComment: string | null
  expanded: boolean
  monthsExpanded: boolean
  months: MonthData[]
  saving: boolean
  dirty: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: string | number): number {
  const n = typeof v === 'string' ? parseFloat(v.replace(/\s/g, '').replace(',', '.')) : v
  return isNaN(n) ? 0 : n
}

function profit(e: Pick<ForecastEntry, 'expectedRevenue' | 'expectedUeCost' | 'expectedInternalCost' | 'expectedOtherCost' | 'riskAmount'>) {
  return e.expectedRevenue - e.expectedUeCost - e.expectedInternalCost - e.expectedOtherCost - e.riskAmount
}

function getWarnings(e: ForecastEntry): string[] {
  const w: string[] = []
  if (e.invoiced === 0 && e.totalSales > 0) w.push('Ingen fakturert beløp registrert på prosjektet')
  if (e.expectedRevenue > e.remaining && e.remaining > 0) w.push('Prognosert omsetning overstiger gjenstående fakturerbar verdi')
  if (e.riskAmount > 0 && !e.comment) w.push('Risiko er lagt inn uten kommentar')
  if (e.expectedOtherCost > 0 && !e.comment) w.push('Annen kostnad er lagt inn uten kommentar')
  return w
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ForecastPeriodPage() {
  const { period: periodParam } = useParams<{ period: string }>()
  const periodName = periodParam.toUpperCase() as 'P1' | 'P2' | 'P3' | 'P4'

  const [period, setPeriod] = useState<ForecastPeriod | null>(null)
  const [entries, setEntries] = useState<Record<string, ForecastEntry>>({})
  const [loading, setLoading] = useState(true)
  const { me } = useMe()
  const userId = me?.id ?? ''
  const userRole = me?.role ?? ''
  const userName = me?.full_name ?? ''
  const [returnInputs, setReturnInputs] = useState<Record<string, string>>({})
  const [showReturnInput, setShowReturnInput] = useState<Record<string, boolean>>({})

  const isAdmin = useCallback(() => userRole === 'main' || userRole === 'project_manager', [userRole])

  const load = useCallback(async () => {
    const year = new Date().getFullYear()

    // Narrow each response to an array — if the API returned { error: ... }
    // (auth lost, 500, etc.) we previously crashed on .find/.filter/.reduce.
    const arr = <T,>(v: unknown): T[] => Array.isArray(v) ? v as T[] : []

    const [periodsData, projectsData, invoicesData, budgetLinesData] = await Promise.all([
      fetch(`/api/forecast-periods?year=${year}`).then((r) => r.json()).then(arr<ForecastPeriod>),
      fetch('/api/projects').then((r) => r.json()).then(arr<Project>),
      fetch('/api/invoices').then((r) => r.json()).then(arr<ProjectInvoice>),
      fetch('/api/budget-lines').then((r) => r.json()).then(arr<ProjectBudgetLine>),
    ])

    const fp = periodsData.find((p) => p.name === periodName)
    if (!fp) { setLoading(false); return }
    setPeriod(fp)

    const forecastsRaw = await fetch(
      `/api/project-forecasts?period_id=${fp.id}&with_months=true`
    ).then((r) => r.json()).catch(() => [])
    const forecasts = arr<ProjectForecast & { months: ProjectForecastMonth[] }>(forecastsRaw)

    const activeProjects = projectsData.filter((p) => p.status === 'active')
    const invoices = invoicesData
    const budgetLines = budgetLinesData

    const forecastMap = new Map(forecasts.map((f) => [f.project_id, f]))
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

    const newEntries: Record<string, ForecastEntry> = {}
    for (const proj of activeProjects) {
      const existing = forecastMap.get(proj.id)
      const projBl = budgetLines.filter((bl: ProjectBudgetLine) => bl.project_id === proj.id)
      const totalSales = projBl.reduce((s: number, bl: ProjectBudgetLine) => s + bl.budget_quantity * bl.customer_price_snapshot, 0)
      const invoiced = invoices.filter((inv: ProjectInvoice) => inv.project_id === proj.id).reduce((s: number, inv: ProjectInvoice) => s + inv.amount, 0)

      const monthRows: MonthData[] = months.map((m) => {
        const em = existing?.months?.find((x) => x.month === m)
        return {
          month: m,
          year: fp.year,
          expected_revenue: em?.expected_revenue ?? 0,
          expected_ue_cost: em?.expected_ue_cost ?? 0,
          expected_internal_cost: em?.expected_internal_cost ?? 0,
          expected_other_cost: em?.expected_other_cost ?? 0,
          risk_amount: em?.risk_amount ?? 0,
          comment: em?.comment ?? '',
        }
      })

      newEntries[proj.id] = {
        projectId: proj.id,
        forecastId: existing?.id ?? null,
        projectName: proj.name,
        projectNumber: proj.project_number,
        customer: proj.customer,
        totalSales,
        invoiced,
        remaining: totalSales - invoiced,
        expectedRevenue: existing?.expected_revenue ?? 0,
        expectedUeCost: existing?.expected_ue_cost ?? 0,
        expectedInternalCost: existing?.expected_internal_cost ?? 0,
        expectedOtherCost: existing?.expected_other_cost ?? 0,
        riskAmount: existing?.risk_amount ?? 0,
        comment: existing?.comment ?? '',
        status: existing?.status ?? 'not_started',
        submittedAt: existing?.submitted_at ?? null,
        approvedBy: existing?.approved_by ?? null,
        returnedComment: existing?.returned_comment ?? null,
        expanded: false,
        monthsExpanded: false,
        months: monthRows,
        saving: false,
        dirty: false,
      }
    }

    setEntries(newEntries)
    setLoading(false)
  }, [periodName])

  useEffect(() => { load() }, [load])

  function update(pid: string, upd: Partial<ForecastEntry>) {
    setEntries((p) => ({ ...p, [pid]: { ...p[pid], ...upd, dirty: true } }))
  }

  function updateMonth(pid: string, idx: number, field: keyof MonthData, value: string | number) {
    setEntries((prev) => {
      const entry = prev[pid]
      const months = [...entry.months]
      months[idx] = { ...months[idx], [field]: typeof value === 'string' && field !== 'comment' ? num(value) : value }
      return { ...prev, [pid]: { ...entry, months, dirty: true } }
    })
  }

  function syncFromMonths(pid: string) {
    setEntries((prev) => {
      const e = prev[pid]
      const rev = e.months.reduce((s, m) => s + m.expected_revenue, 0)
      const ue = e.months.reduce((s, m) => s + m.expected_ue_cost, 0)
      const ic = e.months.reduce((s, m) => s + m.expected_internal_cost, 0)
      const oc = e.months.reduce((s, m) => s + m.expected_other_cost, 0)
      const ri = e.months.reduce((s, m) => s + m.risk_amount, 0)
      return { ...prev, [pid]: { ...e, expectedRevenue: rev, expectedUeCost: ue, expectedInternalCost: ic, expectedOtherCost: oc, riskAmount: ri, dirty: true } }
    })
  }

  async function save(pid: string) {
    if (!period) return
    const e = entries[pid]
    setEntries((p) => ({ ...p, [pid]: { ...p[pid], saving: true } }))

    const payload = {
      forecast_period_id: period.id,
      project_id: pid,
      project_manager_id: userId || null,
      total_sales_value_snapshot: e.totalSales,
      already_invoiced_snapshot: e.invoiced,
      remaining_invoice_value_snapshot: e.remaining,
      expected_revenue: e.expectedRevenue,
      expected_ue_cost: e.expectedUeCost,
      expected_internal_cost: e.expectedInternalCost,
      expected_other_cost: e.expectedOtherCost,
      risk_amount: e.riskAmount,
      expected_profit: profit(e),
      comment: e.comment,
      status: e.status === 'not_started' ? 'draft' : e.status,
    }

    let fid = e.forecastId
    if (fid) {
      await fetch(`/api/project-forecasts/${fid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } else {
      const res = await fetch('/api/project-forecasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      fid = data.id
    }

    if (fid) {
      await fetch('/api/project-forecast-months', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forecast_id: fid, months: e.months }),
      })
    }

    setEntries((p) => ({
      ...p,
      [pid]: { ...p[pid], forecastId: fid, status: p[pid].status === 'not_started' ? 'draft' : p[pid].status, saving: false, dirty: false },
    }))
  }

  async function submit(pid: string) {
    const e = entries[pid]
    if (e.dirty || !e.forecastId) await save(pid)
    const fid = entries[pid].forecastId
    if (!fid) return
    await fetch(`/api/project-forecasts/${fid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'submitted', submitted_at: new Date().toISOString() }),
    })
    setEntries((p) => ({ ...p, [pid]: { ...p[pid], status: 'submitted' } }))
  }

  async function approve(pid: string) {
    const fid = entries[pid].forecastId
    if (!fid) return
    await fetch(`/api/project-forecasts/${fid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', approved_at: new Date().toISOString(), approved_by: userName }),
    })
    setEntries((p) => ({ ...p, [pid]: { ...p[pid], status: 'approved', approvedBy: userName } }))
  }

  async function returnForecast(pid: string) {
    const fid = entries[pid].forecastId
    if (!fid) return
    const rc = returnInputs[pid] ?? ''
    await fetch(`/api/project-forecasts/${fid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'returned', returned_comment: rc }),
    })
    setEntries((p) => ({ ...p, [pid]: { ...p[pid], status: 'returned', returnedComment: rc } }))
    setShowReturnInput((p) => ({ ...p, [pid]: false }))
  }

  async function handleLock() {
    if (!period) return
    const locked = !period.locked
    const updated = await fetch(`/api/forecast-periods/${period.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked, status: locked ? 'locked' : 'open', locked_at: locked ? new Date().toISOString() : null, locked_by: locked ? userName : null }),
    }).then((r) => r.json())
    setPeriod(updated)

    if (locked) {
      for (const e of Object.values(entries)) {
        if (e.status === 'approved' && e.forecastId) {
          await fetch(`/api/project-forecasts/${e.forecastId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'locked' }),
          })
        }
      }
      setEntries((p) => {
        const updated: Record<string, ForecastEntry> = {}
        for (const [k, v] of Object.entries(p)) {
          updated[k] = v.status === 'approved' ? { ...v, status: 'locked' } : v
        }
        return updated
      })
    }
  }

  // ─── Derived ────────────────────────────────────────────────────────────────

  const allEntries = Object.values(entries)
  const totals = {
    totalSales: allEntries.reduce((s, e) => s + e.totalSales, 0),
    invoiced: allEntries.reduce((s, e) => s + e.invoiced, 0),
    remaining: allEntries.reduce((s, e) => s + e.remaining, 0),
    revenue: allEntries.reduce((s, e) => s + e.expectedRevenue, 0),
    ueCost: allEntries.reduce((s, e) => s + e.expectedUeCost, 0),
    internal: allEntries.reduce((s, e) => s + e.expectedInternalCost, 0),
    other: allEntries.reduce((s, e) => s + e.expectedOtherCost, 0),
    risk: allEntries.reduce((s, e) => s + e.riskAmount, 0),
    profit: allEntries.reduce((s, e) => s + profit(e), 0),
  }

  const isLocked = period?.locked ?? false

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)] text-sm">Laster...</div>
  }

  if (!period) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--color-text-muted)]">Prognoseperiode ikke funnet.</p>
        <Link href="/admin/forecasts" className="text-primary text-sm hover:underline">← Tilbake</Link>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <ForecastTabs />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
              Prognose {period.name} {period.year}
            </h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isLocked ? 'bg-gray-200 text-gray-600' : 'bg-green-50 text-green-700'}`}>
              {isLocked ? 'Låst' : 'Åpen'}
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            Jan – Des {period.year} · Prognoseperiode {period.name}
            {period.locked && ` · Låst av ${period.locked_by} ${period.locked_at?.split('T')[0]}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/forecasts" className="text-xs text-[var(--color-text-muted)] hover:underline">
            ← Oversikt
          </Link>
          {isAdmin() && (
            <Button
              variant={isLocked ? 'secondary' : 'primary'}
              className="px-3 py-1.5 text-xs flex items-center gap-1.5"
              onClick={handleLock}
            >
              {isLocked ? <><Unlock size={12} /> Lås opp</> : <><Lock size={12} /> Lås periode</>}
            </Button>
          )}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        {[
          { label: 'Prognosert omsetning', value: totals.revenue, cls: 'text-blue-700' },
          { label: 'UE-kostnad', value: totals.ueCost, cls: '' },
          { label: 'Internkostnad', value: totals.internal, cls: '' },
          { label: 'Risiko', value: totals.risk, cls: 'text-amber-600' },
          { label: 'Forventet fortjeneste', value: totals.profit, cls: totals.profit >= 0 ? 'text-green-600' : 'text-red-600' },
        ].map(({ label, value, cls }) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
            <p className={`text-base font-semibold mt-0.5 ${cls || 'text-[var(--color-text-primary)]'}`}>{fmt(value)}</p>
          </Card>
        ))}
      </div>

      {/* Project rows */}
      {allEntries.length === 0 && (
        <Card className="py-12 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">Ingen aktive prosjekter funnet.</p>
        </Card>
      )}

      <div className="space-y-3">
        {allEntries.map((e) => {
          const warnings = getWarnings(e)
          const p = profit(e)
          const canEdit = !isLocked && (e.status !== 'submitted' || isAdmin()) && e.status !== 'locked'
          const canSubmit = !isLocked && (e.status === 'draft' || e.status === 'returned') && !e.dirty
          const canApprove = isAdmin() && e.status === 'submitted'

          return (
            <Card key={e.projectId} className={`overflow-hidden ${e.dirty ? 'ring-1 ring-blue-300' : ''}`}>
              {/* Collapsed row */}
              <div
                className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => setEntries((prev) => ({ ...prev, [e.projectId]: { ...prev[e.projectId], expanded: !e.expanded } }))}
              >
                <span className="text-[var(--color-text-muted)]">
                  {e.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">{e.projectName}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{e.projectNumber} · {e.customer}</span>
                    {warnings.length > 0 && <AlertTriangle size={13} className="text-amber-500" />}
                    {e.dirty && <span className="text-xs text-blue-500">Ulagret</span>}
                    {e.returnedComment && <span className="text-xs text-red-500">Returnert</span>}
                  </div>
                </div>
                <div className="hidden md:flex items-center gap-6 text-xs shrink-0">
                  <div className="text-right">
                    <p className="text-[var(--color-text-muted)]">Budsjett</p>
                    <p className="font-medium">{fmt(e.totalSales)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[var(--color-text-muted)]">Fakturert</p>
                    <p className="font-medium">{fmt(e.invoiced)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[var(--color-text-muted)]">Omsetning</p>
                    <p className="font-medium text-blue-600">{fmt(e.expectedRevenue)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[var(--color-text-muted)]">DB</p>
                    <p className={`font-medium ${p >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(p)}</p>
                  </div>
                </div>
                {(() => { const m = forecastStatus(e.status); return <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${m.cls}`}>{m.label}</span> })()}
              </div>

              {/* Expanded form */}
              {e.expanded && (
                <div className="border-t border-border px-5 py-5 space-y-5">
                  {/* Return comment display */}
                  {e.returnedComment && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                      <strong>Returnert:</strong> {e.returnedComment}
                    </div>
                  )}

                  {/* Validation warnings */}
                  {warnings.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-1">
                      {warnings.map((w) => (
                        <p key={w} className="text-xs text-amber-700 flex items-center gap-1.5">
                          <AlertTriangle size={12} /> {w}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Financial snapshot */}
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: 'Total salgsverdi (budsjett)', value: e.totalSales },
                      { label: 'Allerede fakturert', value: e.invoiced },
                      { label: 'Gjenstående å fakturere', value: e.remaining, highlight: true },
                    ].map(({ label, value, highlight }) => (
                      <div key={label} className={`rounded-lg p-3 ${highlight ? 'bg-blue-50' : 'bg-muted'}`}>
                        <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
                        <p className={`text-sm font-semibold mt-0.5 ${highlight ? 'text-blue-700' : 'text-[var(--color-text-primary)]'}`}>{fmt(value)}</p>
                      </div>
                    ))}
                  </div>

                  {/* Forecast inputs */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {[
                      { label: 'Forventet omsetning', field: 'expectedRevenue' as const },
                      { label: 'Forventet UE-kostnad', field: 'expectedUeCost' as const },
                      { label: 'Forventet internkostnad', field: 'expectedInternalCost' as const },
                      { label: 'Annen kostnad', field: 'expectedOtherCost' as const },
                      { label: 'Risiko / avsetning', field: 'riskAmount' as const },
                    ].map(({ label, field }) => (
                      <div key={field}>
                        <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">{label}</label>
                        <NumberInput
                          value={e[field] || ''}
                          disabled={!canEdit}
                          onChange={(raw) => update(e.projectId, { [field]: num(raw) })}
                          className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                      </div>
                    ))}
                    <div>
                      <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                        Forventet dekningsbidrag
                      </label>
                      <div className={`px-3 py-2 text-sm rounded-lg bg-muted font-semibold ${p >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {fmt(p)}
                      </div>
                    </div>
                  </div>

                  {/* Comment */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Kommentar / status</label>
                    <textarea
                      rows={2}
                      value={e.comment}
                      disabled={!canEdit}
                      onChange={(ev) => update(e.projectId, { comment: ev.target.value })}
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed resize-none"
                    />
                  </div>

                  {/* Monthly breakdown toggle */}
                  <div>
                    <button
                      className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] font-medium transition-colors"
                      onClick={() => setEntries((prev) => ({ ...prev, [e.projectId]: { ...prev[e.projectId], monthsExpanded: !e.monthsExpanded } }))}
                    >
                      {e.monthsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      Månedlig fordeling
                    </button>

                    {e.monthsExpanded && (
                      <div className="mt-3 space-y-2">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-border">
                                <th className="text-left py-2 pr-4 font-medium text-[var(--color-text-muted)] w-20">Måned</th>
                                {['Omsetning', 'UE-kostnad', 'Intern', 'Annen', 'Risiko', 'Kommentar'].map((h) => (
                                  <th key={h} className="text-left py-2 px-2 font-medium text-[var(--color-text-muted)]">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {e.months.map((m, idx) => (
                                <tr key={m.month} className="border-b border-border last:border-0">
                                  <td className="py-2 pr-4 font-medium text-[var(--color-text-secondary)]">{MONTH_NAMES[m.month]}</td>
                                  {(['expected_revenue', 'expected_ue_cost', 'expected_internal_cost', 'expected_other_cost', 'risk_amount'] as const).map((field) => (
                                    <td key={field} className="py-1.5 px-2">
                                      <NumberInput
                                        value={(m[field] as number) || ''}
                                        disabled={!canEdit}
                                        onChange={(raw) => updateMonth(e.projectId, idx, field, raw)}
                                        className="w-24 px-2 py-1 text-xs border border-border rounded bg-card focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                                      />
                                    </td>
                                  ))}
                                  <td className="py-1.5 px-2">
                                    <input
                                      type="text"
                                      value={m.comment}
                                      disabled={!canEdit}
                                      onChange={(ev) => updateMonth(e.projectId, idx, 'comment', ev.target.value)}
                                      className="w-32 px-2 py-1 text-xs border border-border rounded bg-card focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {canEdit && (
                          <button
                            className="text-xs text-primary hover:underline"
                            onClick={() => syncFromMonths(e.projectId)}
                          >
                            ↑ Synkroniser totaler fra månedlige verdier
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Approved by */}
                  {e.approvedBy && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle size={12} /> Godkjent av {e.approvedBy}
                    </p>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    {canEdit && (
                      <Button
                        variant="secondary"
                        className="px-3 py-1.5 text-xs flex items-center gap-1.5"
                        disabled={e.saving || !e.dirty}
                        onClick={() => save(e.projectId)}
                      >
                        <Save size={12} />
                        {e.saving ? 'Lagrer...' : 'Lagre'}
                      </Button>
                    )}

                    {canSubmit && (
                      <Button
                        variant="primary"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => submit(e.projectId)}
                      >
                        Send inn
                      </Button>
                    )}

                    {e.status === 'draft' && e.dirty && (
                      <Button
                        variant="primary"
                        className="px-3 py-1.5 text-xs"
                        onClick={async () => { await save(e.projectId); await submit(e.projectId) }}
                      >
                        Lagre og send inn
                      </Button>
                    )}

                    {canApprove && (
                      <>
                        <Button
                          variant="primary"
                          className="px-3 py-1.5 text-xs flex items-center gap-1.5 bg-green-600 hover:bg-green-700"
                          onClick={() => approve(e.projectId)}
                        >
                          <CheckCircle size={12} /> Godkjenn
                        </Button>
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs flex items-center gap-1.5"
                          onClick={() => setShowReturnInput((p) => ({ ...p, [e.projectId]: !p[e.projectId] }))}
                        >
                          <RotateCcw size={12} /> Returner
                        </Button>
                        {showReturnInput[e.projectId] && (
                          <div className="flex items-center gap-2 w-full mt-1">
                            <input
                              type="text"
                              placeholder="Kommentar til prosjektleder..."
                              value={returnInputs[e.projectId] ?? ''}
                              onChange={(ev) => setReturnInputs((p) => ({ ...p, [e.projectId]: ev.target.value }))}
                              className="flex-1 px-3 py-1.5 text-xs border border-border rounded-lg bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => returnForecast(e.projectId)}>
                              Send retur
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {/* Period totals footer */}
      {allEntries.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Totaler — {period.name} {period.year}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 text-xs">
            {[
              { label: 'Total budsjett', value: totals.totalSales },
              { label: 'Fakturert', value: totals.invoiced },
              { label: 'Gjenstående', value: totals.remaining },
              { label: 'Prognosert omsetning', value: totals.revenue, bold: true },
              { label: 'UE-kostnad', value: totals.ueCost },
              { label: 'Internkostnad', value: totals.internal },
              { label: 'Annen kostnad', value: totals.other },
              { label: 'Risiko', value: totals.risk, cls: 'text-amber-600' },
              { label: 'Forventet fortjeneste', value: totals.profit, bold: true, cls: totals.profit >= 0 ? 'text-green-600' : 'text-red-600' },
            ].map(({ label, value, bold, cls }) => (
              <div key={label}>
                <p className="text-[var(--color-text-muted)]">{label}</p>
                <p className={`font-${bold ? 'bold' : 'medium'} text-sm mt-0.5 ${cls ?? 'text-[var(--color-text-primary)]'}`}>{fmt(value)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
