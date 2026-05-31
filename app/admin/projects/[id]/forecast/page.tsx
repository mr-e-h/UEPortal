'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Save, CalendarDays, Plus, Trash2 } from 'lucide-react'
import type { Project, ProjectBudgetLine, WeeklyReport, WeeklyReportLine, ChangeOrder, HourEntry, ProjectMonthPlan, ProjectInvoice, TimeType } from '@/types'
import NumberInput from '@/components/NumberInput'
import { MONTHS_SHORT as MND, fmtNOK as fmt, fmtShort } from '@/lib/format'
import {
  FORECAST_CATEGORIES,
  FORECAST_PLAN_KEY as PLAN_KEY,
  FORECAST_TIME_ROLES,
  FORECAST_ROLE_LABEL as ROLE_LABELS,
  getRoleCostPerHour,
  type ForecastField as Field,
  type ForecastRoleKey as Role,
} from '@/lib/forecast-categories'
function buildGrid(start: string, end: string) {
  const result: { year: number; month: number }[] = []
  let cur  = new Date(new Date(start).getFullYear(), new Date(start).getMonth(), 1)
  const to = new Date(new Date(end).getFullYear(),   new Date(end).getMonth(),   1)
  while (cur <= to) {
    result.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 })
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  }
  return result
}

const ROWS = FORECAST_CATEGORIES
const ROLES: Role[] = FORECAST_TIME_ROLES.map((r) => r.key)

type ForecastExtra = {
  id: string
  project_id: string
  type: 'role' | 'custom' | 'comment'
  role: Role | null
  line_name: string | null
  year: number
  month: number
  value: number
  text?: string
}

type WRWithLines = WeeklyReport & { lines: WeeklyReportLine[] }

export default function ForecastPage() {
  const { id } = useParams<{ id: string }>()

  const [project,         setProject]         = useState<Project | null>(null)
  const [budgetLines,     setBudgetLines]      = useState<ProjectBudgetLine[]>([])
  const [weeklyReports,   setWeeklyReports]    = useState<WRWithLines[]>([])
  const [changeOrders,    setChangeOrders]     = useState<ChangeOrder[]>([])
  const [hourEntries,     setHourEntries]      = useState<HourEntry[]>([])
  const [monthPlans,      setMonthPlans]       = useState<ProjectMonthPlan[]>([])
  const [invoices,        setInvoices]         = useState<ProjectInvoice[]>([])
  const [extras,          setExtras]           = useState<ForecastExtra[]>([])
  const [customLineNames, setCustomLineNames]  = useState<string[]>([])
  const [generalComment,  setGeneralComment]   = useState('')
  const [timeTypes,       setTimeTypes]        = useState<TimeType[]>([])
  const [loading,         setLoading]          = useState(true)
  const [edits,           setEdits]            = useState<Record<string, string | number>>({})
  const [saving,          setSaving]           = useState(false)
  const [dirty,           setDirty]            = useState(false)
  const [saved,           setSaved]            = useState(false)

  const fetchAll = useCallback(async () => {
    const [allProj, bls, wrls, cos, hes, mp, inv, ext, tt] = await Promise.all([
      fetch('/api/projects').then((r) => r.json()),
      fetch(`/api/budget-lines?project_id=${id}`).then((r) => r.json()),
      fetch(`/api/weekly-reports?project_id=${id}&with_lines=true`).then((r) => r.json()),
      fetch(`/api/change-orders?project_id=${id}`).then((r) => r.json()),
      fetch(`/api/hour-entries?project_id=${id}`).then((r) => r.json()),
      fetch(`/api/project-month-plans?project_id=${id}`).then((r) => r.json()),
      fetch(`/api/invoices?project_id=${id}`).then((r) => r.json()),
      fetch(`/api/project-forecast-extras?project_id=${id}`).then((r) => r.json()),
      fetch('/api/time-types').then((r) => r.json()),
    ])
    setProject((allProj as Project[]).find((p) => p.id === id) ?? null)
    setBudgetLines(Array.isArray(bls) ? bls : [])
    setWeeklyReports(Array.isArray(wrls) ? wrls : [])
    setChangeOrders(Array.isArray(cos) ? cos : [])
    setHourEntries(Array.isArray(hes) ? hes : [])
    setMonthPlans(Array.isArray(mp) ? mp : [])
    setInvoices(Array.isArray(inv) ? inv : [])
    const extArr: ForecastExtra[] = Array.isArray(ext) ? ext : []
    setExtras(extArr)
    // Derive ordered unique custom line names
    const seen = new Set<string>()
    const names: string[] = []
    for (const e of extArr) {
      if (e.type === 'custom' && e.line_name && !seen.has(e.line_name)) {
        seen.add(e.line_name)
        names.push(e.line_name)
      }
    }
    setCustomLineNames(names)
    setGeneralComment(extArr.find((e) => e.type === 'comment' && e.line_name === 'general')?.text ?? '')
    setTimeTypes(Array.isArray(tt) ? tt : [])
    setLoading(false)
  }, [id])

  useEffect(() => { fetchAll() }, [fetchAll])

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Laster...</div>
  if (!project) return <div className="flex items-center justify-center h-64 text-gray-500">Prosjekt ikke funnet</div>

  if (!project.start_date || !project.end_date) {
    return (
      <div className="p-6">
        <Link href={`/admin/projects/${id}`} className="text-xs text-gray-400 hover:underline">← {project.name}</Link>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 flex flex-col items-center gap-3 text-center max-w-md mx-auto mt-12">
          <CalendarDays size={32} className="text-amber-500" />
          <p className="font-semibold text-amber-900">Startdato og sluttdato mangler</p>
          <p className="text-sm text-amber-700">Legg til start- og sluttdato for å bruke prognosemodulen.</p>
          <Link href={`/admin/projects/${id}/edit`} className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700">
            Gå til prosjektinnstillinger
          </Link>
        </div>
      </div>
    )
  }

  const blMap    = new Map(budgetLines.map((b) => [b.id, b]))
  const now      = new Date()
  const curYear  = now.getFullYear()
  const curMonth = now.getMonth() + 1
  const grid     = buildGrid(project.start_date, project.end_date)

  function isPast(year: number, month: number) {
    return year < curYear || (year === curYear && month < curMonth)
  }

  // ── Actuals (all years) ──────────────────────────────────────────────────
  const actuals: Record<string, Partial<Record<Field, number>>> = {}
  function bump(year: number, month: number, field: Field, v: number) {
    const k = `${year}-${month}`
    if (!actuals[k]) actuals[k] = {}
    actuals[k][field] = (actuals[k][field] ?? 0) + v
  }

  weeklyReports
    .filter((wr) => wr.status === 'approved' || wr.status === 'partially_approved')
    .forEach((wr) => {
      wr.lines.filter((l) => l.status === 'approved').forEach((l) => {
        const bl = blMap.get(l.project_budget_line_id)
        if (!bl || !wr.submitted_at) return
        const d = new Date(wr.submitted_at)
        bump(d.getFullYear(), d.getMonth() + 1, 'ueCost',  l.reported_quantity * (bl.subcontractor_cost_price_snapshot ?? 0))
        bump(d.getFullYear(), d.getMonth() + 1, 'revenue', l.reported_quantity * (bl.customer_price_snapshot ?? 0))
      })
    })

  changeOrders
    .filter((co) => co.status === 'approved' && (co.reviewed_at ?? co.submitted_at))
    .forEach((co) => {
      // Use reviewed_at (approval date) so revenue lands in the correct period
      const d = new Date((co.reviewed_at ?? co.submitted_at)!)
      bump(d.getFullYear(), d.getMonth() + 1, 'ueCost',  co.total_cost)
      bump(d.getFullYear(), d.getMonth() + 1, 'revenue', co.total_customer_value)
    })

  hourEntries.filter((he) => he.date).forEach((he) => {
    const d = new Date(he.date)
    bump(d.getFullYear(), d.getMonth() + 1, 'internalCost',  he.hours * he.cost_per_hour_snapshot)
    bump(d.getFullYear(), d.getMonth() + 1, 'internalHours', he.hours)
  })

  const planMap = new Map(monthPlans.map((p) => [`${p.year}-${p.month}`, p]))

  // ── Cell value (main table) ───────────────────────────────────────────────
  function getVal(year: number, month: number, field: Field): number {
    const editKey = `${year}-${month}-${field}`
    if (editKey in edits) return edits[editKey] as number

    if (isPast(year, month)) {
      const actual = actuals[`${year}-${month}`]?.[field]
      if (actual !== undefined) return actual
    }

    const plan = planMap.get(`${year}-${month}`)
    if (!plan) return 0
    return (plan[PLAN_KEY[field]] as number) ?? 0
  }

  function setEdit(year: number, month: number, field: Field, val: number) {
    setEdits((p) => ({ ...p, [`${year}-${month}-${field}`]: val }))
    setDirty(true)
    setSaved(false)
  }

  // ── Extra value (role hours + custom costs) ──────────────────────────────
  function getExtra(typeKey: string, year: number, month: number): number {
    const editKey = `extra-${typeKey}-${year}-${month}`
    if (editKey in edits) return edits[editKey] as number
    const entry = extras.find((e) => {
      const key = e.type === 'role' ? `role-${e.role}` : `custom-${e.line_name}`
      return key === typeKey && e.year === year && e.month === month
    })
    return entry?.value ?? 0
  }

  function setExtra(typeKey: string, year: number, month: number, val: number) {
    setEdits((p) => ({ ...p, [`extra-${typeKey}-${year}-${month}`]: val }))
    setDirty(true)
    setSaved(false)
  }

  function extraRowTotal(typeKey: string): number {
    return grid.reduce((s, { year, month }) => s + getExtra(typeKey, year, month), 0)
  }

  function roleCostPerHour(role: Role): number {
    return getRoleCostPerHour(role, timeTypes)
  }

  function roleInternalCost(role: Role, year: number, month: number): number {
    return getExtra(`role-${role}`, year, month) * roleCostPerHour(role)
  }


  // ── Budget totals ────────────────────────────────────────────────────────
  const manualLines = budgetLines.filter((bl) => !bl.source || bl.source === 'manual')
  const approvedCOs = changeOrders.filter((co) => co.status === 'approved')

  const budgetRevenue = manualLines.reduce((s, bl) => s + bl.budget_quantity * bl.customer_price_snapshot, 0)
    + approvedCOs.reduce((s, co) => s + co.total_customer_value, 0)

  const budgetCost = manualLines
    .filter((bl) => bl.assigned_subcontractor_id)
    .reduce((s, bl) => s + bl.budget_quantity * bl.subcontractor_cost_price_snapshot, 0)
    + approvedCOs.reduce((s, co) => s + co.total_cost, 0)

  const totalApprovedRevenue = Object.values(actuals).reduce((s, a) => s + (a.revenue ?? 0), 0)
  const totalApprovedCost    = Object.values(actuals).reduce((s, a) => s + (a.ueCost ?? 0), 0)
  const totalInvoiced        = invoices.reduce((s, inv) => s + inv.amount, 0)

  const planRevenue = grid.reduce((s, { year, month }) => s + (getVal(year, month, 'revenue') as number), 0)
  const planCost    = grid.reduce((s, { year, month }) => s + (getVal(year, month, 'ueCost')   as number), 0)

  // ── Row total ────────────────────────────────────────────────────────────
  function rowTotal(field: Field): number {
    return grid.reduce((s, { year, month }) => s + getVal(year, month, field), 0)
  }

  function fmtTotal(n: number, unit: 'kr' | 'timer') {
    if (unit === 'kr')    return fmt(n)
    return `${new Intl.NumberFormat('nb-NO').format(n)} t`
  }

  // ── Custom line management ───────────────────────────────────────────────
  function addCustomLine() {
    const name = `Kostnad ${customLineNames.length + 1}`
    setCustomLineNames((prev) => [...prev, name])
    setDirty(true)
    setSaved(false)
  }

  function removeCustomLine(name: string) {
    setCustomLineNames((prev) => prev.filter((n) => n !== name))
    // Clear any edits for this line
    setEdits((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        if (k.startsWith(`extra-custom-${name}-`)) delete next[k]
      }
      return next
    })
    setDirty(true)
    setSaved(false)
  }

  function renameCustomLine(oldName: string, newName: string) {
    if (!newName.trim() || newName === oldName) return
    setCustomLineNames((prev) => prev.map((n) => (n === oldName ? newName : n)))
    // Migrate edits from old name to new name
    setEdits((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        if (k.startsWith(`extra-custom-${oldName}-`)) {
          const newKey = k.replace(`extra-custom-${oldName}-`, `extra-custom-${newName}-`)
          next[newKey] = next[k]
          delete next[k]
        }
      }
      return next
    })
    setDirty(true)
    setSaved(false)
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)

    // Main month plan rows
    const rows = grid
      .map(({ year, month }) => {
        const revenue       = getVal(year, month, 'revenue')       as number
        const ueCost        = getVal(year, month, 'ueCost')        as number
        const ueHours       = getVal(year, month, 'ueHours')       as number
        const internalCost  = getVal(year, month, 'internalCost')  as number
        const internalHours = getVal(year, month, 'internalHours') as number
        const otherCost     = getVal(year, month, 'otherCost')     as number
        const risk          = getVal(year, month, 'risk')          as number
        if (!revenue && !ueCost && !ueHours && !internalCost && !internalHours && !otherCost && !risk) return null
        return { project_id: id, year, month, expected_revenue: revenue, ue_cost: ueCost, ue_hours: ueHours, internal_cost: internalCost, internal_hours: internalHours, other_cost: otherCost, risk, comment: '' }
      })
      .filter(Boolean)

    // Extras rows
    const extraRows: Omit<ForecastExtra, 'id'>[] = []
    for (const { year, month } of grid) {
      for (const role of ROLES) {
        const v = getExtra(`role-${role}`, year, month)
        if (v) extraRows.push({ project_id: id, type: 'role', role, line_name: null, year, month, value: v })
      }
      for (const name of customLineNames) {
        const v = getExtra(`custom-${name}`, year, month)
        if (v) extraRows.push({ project_id: id, type: 'custom', role: null, line_name: name, year, month, value: v })
      }
    }

    if (generalComment) {
      extraRows.push({ project_id: id, type: 'comment', role: null, line_name: 'general', year: 0, month: 0, value: 0, text: generalComment })
    }

    await Promise.all([
      fetch('/api/project-month-plans', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ project_id: id, rows }),
      }),
      fetch('/api/project-forecast-extras', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ project_id: id, rows: extraRows }),
      }),
    ])

    setSaving(false); setDirty(false); setSaved(true); setEdits({})
    fetchAll()
  }

  // Group by year for column headers
  const yearGroups: { year: number; count: number }[] = []
  for (const { year } of grid) {
    const last = yearGroups[yearGroups.length - 1]
    if (last?.year === year) last.count++
    else yearGroups.push({ year, count: 1 })
  }

  // ── Shared table header ───────────────────────────────────────────────────
  function TableHeader({ labelCol }: { labelCol: string }) {
    return (
      <thead>
        <tr className="bg-gray-100 border-b border-gray-200">
          <th className="px-4 py-1.5 sticky left-0 bg-gray-100 z-10 text-left" style={{ minWidth: 160 }} />
          {yearGroups.map(({ year, count }) => (
            <th key={year} colSpan={count}
              className="px-3 py-1.5 text-center text-xs font-bold text-gray-600 uppercase tracking-wider border-l border-gray-300">
              {year}
            </th>
          ))}
          <th className="px-4 py-1.5 text-right text-xs font-bold text-gray-500 uppercase border-l border-gray-300" style={{ minWidth: 108 }}>Totalt</th>
        </tr>
        <tr className="bg-gray-50 border-b border-gray-100">
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase sticky left-0 bg-gray-50 z-10" style={{ minWidth: 160 }}>{labelCol}</th>
          {grid.map(({ year, month }) => {
            const isCur = year === curYear && month === curMonth
            const past  = isPast(year, month)
            return (
              <th key={`${year}-${month}`}
                className={`px-2 py-2 text-center text-xs font-medium uppercase ${isCur ? 'text-blue-600' : past ? 'text-gray-400' : 'text-gray-500'} ${month === 1 ? 'border-l border-gray-300' : ''}`}
                style={{ minWidth: 72 }}>
                {MND[month]}
                {isCur && <span className="block text-[9px] font-normal text-blue-400 normal-case">nå</span>}
              </th>
            )
          })}
          <th className="px-4 py-2 border-l border-gray-200" style={{ minWidth: 108 }} />
        </tr>
      </thead>
    )
  }

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/admin/projects/${id}`} className="text-gray-400 hover:text-gray-600 text-sm">← {project.name}</Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">Prognosemodul</h1>
          <p className="text-sm text-gray-500">{project.project_number} · {project.customer} · {grid.length} måneder</p>
        </div>
        <button onClick={handleSave} disabled={saving || !dirty}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          <Save size={14} />
          {saving ? 'Lagrer...' : saved && !dirty ? 'Lagret ✓' : 'Lagre prognose'}
        </button>
      </div>

      {/* ── Igjen å fordele ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          {
            title:     'Inntekt igjen å fordele',
            remaining: budgetRevenue - planRevenue,
            budget:    budgetRevenue,
            planned:   planRevenue,
            pct:       budgetRevenue > 0 ? Math.round((planRevenue / budgetRevenue) * 100) : 0,
            barColor:  'bg-green-500',
            details: [
              { label: 'I plan',                value: planRevenue,           color: 'text-gray-800'  },
              { label: 'Rapportert/godkjent',    value: totalApprovedRevenue,  color: 'text-green-700' },
              { label: 'Fakturert av meg',        value: totalInvoiced,         color: 'text-blue-700'  },
            ],
            budgetLabel: 'kontraktsverdi',
          },
          {
            title:     'UE-kostnad igjen å fordele',
            remaining: budgetCost - planCost,
            budget:    budgetCost,
            planned:   planCost,
            pct:       budgetCost > 0 ? Math.round((planCost / budgetCost) * 100) : 0,
            barColor:  'bg-orange-500',
            details: [
              { label: 'I plan',                 value: planCost,             color: 'text-gray-800'   },
              { label: 'Godkjent rapportert',    value: totalApprovedCost,    color: 'text-orange-700' },
              { label: 'Budsjett UE',            value: budgetCost,           color: 'text-gray-600'   },
            ],
            budgetLabel: 'budsjettert UE-kostnad',
          },
        ].map(({ title, remaining, budget, pct, barColor, details, budgetLabel }) => (
          <div key={title} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className={`text-2xl font-bold ${remaining < 0 ? 'text-red-600' : 'text-gray-900'}`}>{fmt(remaining)}</p>
                <p className="text-xs text-gray-400 mt-0.5">av {fmt(budget)} {budgetLabel}</p>
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${remaining < 0 ? 'bg-red-50 text-red-700' : remaining === 0 ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                {remaining < 0 ? 'Overfordelt' : `${pct}% fordelt`}
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div className={`${barColor} h-1.5 rounded-full transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs pt-2 border-t border-gray-100">
              {details.map(({ label, value, color }) => (
                <div key={label}>
                  <p className="text-gray-400 mb-0.5">{label}</p>
                  <p className={`font-semibold ${color}`}>{fmt(value)}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Transposed monthly table ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-900">Månedlig fordeling</h2>
          <p className="text-xs text-gray-400 mt-0.5">Historiske måneder viser faktiske tall · Fremtidige måneder er redigerbare</p>
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse">
            <TableHeader labelCol="Kategori" />
            <tbody>
              {ROWS.map(({ key, label, color, unit }) => {
                const total = rowTotal(key)
                return (
                  <tr key={key} className="border-b border-gray-50 hover:bg-gray-50/40">
                    <td className={`px-4 py-2 font-semibold sticky left-0 bg-white z-10 ${color} whitespace-nowrap`} style={{ minWidth: 160 }}>
                      {label}
                      <span className="ml-1 text-[10px] font-normal text-gray-400">({unit})</span>
                    </td>
                    {grid.map(({ year, month }) => {
                      const past    = isPast(year, month)
                      const isCur   = year === curYear && month === curMonth
                      const val     = getVal(year, month, key)
                      const borderL = month === 1 ? 'border-l border-gray-200' : ''

                      if (past) {
                        return (
                          <td key={`${year}-${month}`}
                            className={`px-2 py-2 text-right text-xs text-gray-400 ${borderL}`}
                            style={{ minWidth: 72 }}>
                            {val > 0 ? (unit === 'timer' ? `${Math.round(val)}t` : fmtShort(val)) : '–'}
                          </td>
                        )
                      }
                      return (
                        <td key={`${year}-${month}`}
                          className={`px-1 py-1 ${isCur ? 'bg-blue-50/40' : ''} ${borderL}`}
                          style={{ minWidth: 72 }}>
                          <NumberInput
                            value={val || ''} placeholder="0"
                            onChange={(raw) => setEdit(year, month, key, Number(raw))}
                            className="w-full text-right px-1.5 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-800 bg-white"
                          />
                        </td>
                      )
                    })}
                    <td className={`px-4 py-2 text-right font-bold text-sm ${color} border-l border-gray-200 whitespace-nowrap`} style={{ minWidth: 108 }}>
                      {fmtTotal(total, unit)}
                    </td>
                  </tr>
                )
              })}

              {/* Fortjeneste */}
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td className="px-4 py-2.5 font-bold text-gray-700 sticky left-0 bg-gray-50 z-10" style={{ minWidth: 160 }}>Fortjeneste</td>
                {grid.map(({ year, month }) => {
                  const profit = (getVal(year, month, 'revenue')      as number)
                               - (getVal(year, month, 'ueCost')       as number)
                               - (getVal(year, month, 'internalCost') as number)
                               - (getVal(year, month, 'otherCost')    as number)
                               - (getVal(year, month, 'risk')         as number)
                  const past    = isPast(year, month)
                  const borderL = month === 1 ? 'border-l border-gray-200' : ''
                  return (
                    <td key={`${year}-${month}`}
                      className={`px-2 py-2.5 text-right text-xs font-medium ${profit > 0 ? 'text-green-600' : profit < 0 ? 'text-red-600' : 'text-gray-300'} ${past ? 'opacity-70' : ''} ${borderL}`}
                      style={{ minWidth: 72 }}>
                      {fmtShort(profit)}
                    </td>
                  )
                })}
                {(() => {
                  const total = grid.reduce((s, { year, month }) =>
                    s + (getVal(year, month, 'revenue')      as number)
                      - (getVal(year, month, 'ueCost')       as number)
                      - (getVal(year, month, 'internalCost') as number)
                      - (getVal(year, month, 'otherCost')    as number)
                      - (getVal(year, month, 'risk')         as number), 0)
                  return (
                    <td className={`px-4 py-2.5 text-right font-bold text-sm border-l border-gray-200 ${total >= 0 ? 'text-green-700' : 'text-red-700'}`} style={{ minWidth: 108 }}>
                      {fmt(total)}
                    </td>
                  )
                })()}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Tilleggskostnader (custom cost lines) ────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Tilleggskostnader</h2>
            <p className="text-xs text-gray-400 mt-0.5">Egendefinerte kostnadslinjer per måned</p>
          </div>
          <button onClick={addCustomLine}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition-colors">
            <Plus size={12} />
            Ny linje
          </button>
        </div>

        {customLineNames.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">
            Ingen tilleggskostnader lagt til. Klikk &quot;Ny linje&quot; for å legge til.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse">
              <TableHeader labelCol="Kostnadslinje" />
              <tbody>
                {customLineNames.map((name) => {
                  const typeKey = `custom-${name}`
                  const total = extraRowTotal(typeKey)
                  return (
                    <tr key={name} className="border-b border-gray-50 hover:bg-gray-50/40 group">
                      <td className="px-2 py-1.5 sticky left-0 bg-white z-10 whitespace-nowrap" style={{ minWidth: 160 }}>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            defaultValue={name}
                            onBlur={(e) => renameCustomLine(name, e.target.value)}
                            className="w-full px-2 py-1 text-xs font-semibold text-rose-700 border border-transparent rounded focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-transparent hover:border-gray-200"
                          />
                          <button onClick={() => removeCustomLine(name)}
                            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 p-0.5 rounded">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                      {grid.map(({ year, month }) => {
                        const isCur   = year === curYear && month === curMonth
                        const borderL = month === 1 ? 'border-l border-gray-200' : ''
                        const val     = getExtra(typeKey, year, month)
                        return (
                          <td key={`${year}-${month}`}
                            className={`px-1 py-1 ${isCur ? 'bg-blue-50/40' : ''} ${borderL}`}
                            style={{ minWidth: 72 }}>
                            <NumberInput
                              value={val || ''} placeholder="0"
                              onChange={(raw) => setExtra(typeKey, year, month, Number(raw))}
                              className="w-full text-right px-1.5 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-800 bg-white"
                            />
                          </td>
                        )
                      })}
                      <td className="px-4 py-2 text-right font-bold text-sm text-rose-700 border-l border-gray-200 whitespace-nowrap" style={{ minWidth: 108 }}>
                        {total > 0 ? fmt(total) : '–'}
                      </td>
                    </tr>
                  )
                })}
                {/* Sum row */}
                {customLineNames.length > 1 && (
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td className="px-4 py-2.5 font-bold text-gray-700 sticky left-0 bg-gray-50 z-10" style={{ minWidth: 160 }}>Sum</td>
                    {grid.map(({ year, month }) => {
                      const total   = customLineNames.reduce((s, n) => s + getExtra(`custom-${n}`, year, month), 0)
                      const borderL = month === 1 ? 'border-l border-gray-200' : ''
                      return (
                        <td key={`${year}-${month}`}
                          className={`px-2 py-2.5 text-right text-xs font-medium text-gray-600 ${borderL}`}
                          style={{ minWidth: 72 }}>
                          {total > 0 ? fmtShort(total) : '–'}
                        </td>
                      )
                    })}
                    <td className="px-4 py-2.5 text-right font-bold text-sm text-gray-700 border-l border-gray-200" style={{ minWidth: 108 }}>
                      {(() => {
                        const t = customLineNames.reduce((s, n) => s + extraRowTotal(`custom-${n}`), 0)
                        return t > 0 ? fmt(t) : '–'
                      })()}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Timeoversikt (hours by role) ─────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-900">Timeoversikt</h2>
          <p className="text-xs text-gray-400 mt-0.5">Planlagte timer per rolle per måned</p>
        </div>
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse">
            <TableHeader labelCol="Rolle" />
            <tbody>
              {ROLES.map((role) => {
                const typeKey = `role-${role}`
                const total = extraRowTotal(typeKey)
                return (
                  <tr key={role} className="border-b border-gray-50 hover:bg-gray-50/40">
                    <td className="px-4 py-2 font-semibold sticky left-0 bg-white z-10 text-indigo-700 whitespace-nowrap" style={{ minWidth: 160 }}>
                      {ROLE_LABELS[role]}
                      <span className="ml-1 text-[10px] font-normal text-gray-400">(timer)</span>
                    </td>
                    {grid.map(({ year, month }) => {
                      const isCur   = year === curYear && month === curMonth
                      const borderL = month === 1 ? 'border-l border-gray-200' : ''
                      const val     = getExtra(typeKey, year, month)
                      return (
                        <td key={`${year}-${month}`}
                          className={`px-1 py-1 ${isCur ? 'bg-blue-50/40' : ''} ${borderL}`}
                          style={{ minWidth: 72 }}>
                          <NumberInput
                            value={val || ''} placeholder="0"
                            onChange={(raw) => setExtra(typeKey, year, month, Number(raw))}
                            className="w-full text-right px-1.5 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-800 bg-white"
                          />
                        </td>
                      )
                    })}
                    <td className="px-4 py-2 text-right font-bold text-sm text-indigo-700 border-l border-gray-200 whitespace-nowrap" style={{ minWidth: 108 }}>
                      {total > 0 ? `${new Intl.NumberFormat('nb-NO').format(total)} t` : '–'}
                    </td>
                  </tr>
                )
              })}
              {/* Total hours row */}
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td className="px-4 py-2.5 font-bold text-gray-700 sticky left-0 bg-gray-50 z-10" style={{ minWidth: 160 }}>Sum timer</td>
                {grid.map(({ year, month }) => {
                  const total   = ROLES.reduce((s, r) => s + getExtra(`role-${r}`, year, month), 0)
                  const borderL = month === 1 ? 'border-l border-gray-200' : ''
                  return (
                    <td key={`${year}-${month}`}
                      className={`px-2 py-2.5 text-right text-xs font-medium text-gray-600 ${borderL}`}
                      style={{ minWidth: 72 }}>
                      {total > 0 ? `${total}t` : '–'}
                    </td>
                  )
                })}
                <td className="px-4 py-2.5 text-right font-bold text-sm text-gray-700 border-l border-gray-200" style={{ minWidth: 108 }}>
                  {(() => {
                    const t = ROLES.reduce((s, r) => s + extraRowTotal(`role-${r}`), 0)
                    return t > 0 ? `${new Intl.NumberFormat('nb-NO').format(t)} t` : '–'
                  })()}
                </td>
              </tr>
              {/* Internal cost per role */}
              {ROLES.map((role) => {
                const rate  = roleCostPerHour(role)
                const total = grid.reduce((s, { year, month }) => s + roleInternalCost(role, year, month), 0)
                return (
                  <tr key={`cost-${role}`} className="border-b border-gray-50 hover:bg-gray-50/40">
                    <td className="px-4 py-2 sticky left-0 bg-white z-10 whitespace-nowrap" style={{ minWidth: 160 }}>
                      <span className="text-purple-600 font-semibold text-xs">{ROLE_LABELS[role]}</span>
                      {rate > 0 && <span className="ml-1 text-[10px] text-gray-400">{new Intl.NumberFormat('nb-NO').format(rate)} kr/t</span>}
                    </td>
                    {grid.map(({ year, month }) => {
                      const cost    = roleInternalCost(role, year, month)
                      const borderL = month === 1 ? 'border-l border-gray-200' : ''
                      return (
                        <td key={`${year}-${month}`}
                          className={`px-2 py-2 text-right text-xs text-purple-600 ${borderL}`}
                          style={{ minWidth: 72 }}>
                          {cost > 0 ? fmtShort(cost) : '–'}
                        </td>
                      )
                    })}
                    <td className="px-4 py-2 text-right font-bold text-xs text-purple-600 border-l border-gray-200 whitespace-nowrap" style={{ minWidth: 108 }}>
                      {total > 0 ? fmt(total) : '–'}
                    </td>
                  </tr>
                )
              })}
              {/* Total internal cost */}
              <tr className="border-t-2 border-gray-200 bg-purple-50">
                <td className="px-4 py-2.5 font-bold text-purple-700 sticky left-0 bg-purple-50 z-10" style={{ minWidth: 160 }}>Sum internkostnad</td>
                {grid.map(({ year, month }) => {
                  const total   = ROLES.reduce((s, r) => s + roleInternalCost(r, year, month), 0)
                  const borderL = month === 1 ? 'border-l border-gray-200' : ''
                  return (
                    <td key={`${year}-${month}`}
                      className={`px-2 py-2.5 text-right text-xs font-medium text-purple-700 ${borderL}`}
                      style={{ minWidth: 72 }}>
                      {total > 0 ? fmtShort(total) : '–'}
                    </td>
                  )
                })}
                <td className="px-4 py-2.5 text-right font-bold text-sm text-purple-700 border-l border-gray-200" style={{ minWidth: 108 }}>
                  {(() => {
                    const t = ROLES.reduce((s, r) => s + grid.reduce((s2, { year, month }) => s2 + roleInternalCost(r, year, month), 0), 0)
                    return t > 0 ? fmt(t) : '–'
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Kommentar ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-2">
        <label className="text-sm font-semibold text-gray-700">Kommentar</label>
        <textarea
          rows={3}
          value={generalComment}
          onChange={(e) => { setGeneralComment(e.target.value); setDirty(true); setSaved(false) }}
          placeholder="Skriv generelle kommentarer til prognosen her..."
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-700 resize-none"
        />
      </div>

      {dirty && (
        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
            <Save size={14} />
            {saving ? 'Lagrer...' : 'Lagre prognose'}
          </button>
        </div>
      )}
    </main>
  )
}
