'use client'

import { useState, type RefObject } from 'react'
import dynamic from 'next/dynamic'
import { Download } from 'lucide-react'
import SortableTable from '@/components/SortableTable'
import NumberInput from '@/components/NumberInput'
import { fmtNOK as fmt, fmtProductLabel } from '@/lib/format'
import { lineTypeLabel } from '@/lib/line-types'
import type { ProjectBudgetLine, Product, Subcontractor, ChangeOrder, Project, BudgetVersion, ProjectPhase, PhaseType } from '@/types'

// BudgetLineChart is lazy-loaded — only mounts when a row is expanded.
const BudgetLineChart = dynamic(() => import('@/components/BudgetLineChart'), { ssr: false })

type BLRow = {
  id: string
  product_code: string
  product_name: string
  unit: string
  source: string
  budget_quantity: number
  customer_price_snapshot: number
  sales_value: number
  assigned_subcontractor_id: string | null
  assigned_name: string
  subcontractor_cost_price_snapshot: number
  cost_value: number
  profit: number
  line_type: string
  phase_id: string | null
}

interface Props {
  project: Project
  budgetLines: ProjectBudgetLine[]
  allProducts: Product[]
  allSubs: Subcontractor[]
  projectSubDetails: Subcontractor[]
  changeOrders: ChangeOrder[]
  // Faser + tagging: tagger man en budsjettlinje til en fase, avledes fasevekten
  // i prognosen fra linjene (ØKONOMIMODELL.md 1b).
  phases: ProjectPhase[]
  phaseTypes: PhaseType[]
  onAssignPhase: (lineId: string, phaseId: string | null) => void

  // form state — owned by parent so it survives tab switches
  showAddLine: boolean
  setShowAddLine: (v: boolean | ((prev: boolean) => boolean)) => void
  newLine: { product_id: string; budget_quantity: string; line_type: string }
  setNewLine: (updater: (prev: { product_id: string; budget_quantity: string; line_type: string }) => { product_id: string; budget_quantity: string; line_type: string }) => void
  savingLine: boolean
  onAddBudgetLine: (e: React.FormEvent) => void
  /** Re-henter prosjektdata etter at en egendefinert UE-linje er lagt til. */
  onRefresh: () => void

  // bulk-assign state
  selected: string[]
  setSelected: (updater: (prev: string[]) => string[]) => void
  bulkSubcontractor: string
  setBulkSubcontractor: (v: string) => void
  bulkError: string
  onBulkAssign: () => void
  allChecked: boolean
  onToggleAll: () => void
  onToggleRow: (rowId: string) => void

  // type filter
  lineTypeFilter: string
  setLineTypeFilter: (v: string) => void

  // expanded-chart state
  chartLineId: string | null
  setChartLineId: (id: string | null) => void

  // Excel import
  importFileRef: RefObject<HTMLInputElement>
  importing: boolean
  importMsg: string
  onImport: (file: File) => void

  // Budsjettversjon-historikk + Excel-import (drag/drop) — moved here
  // from Oversikt so all budget-related material lives in one tab.
  budgetVersions: BudgetVersion[]
  dragOver: boolean
  setDragOver: (v: boolean) => void
}

// ── CustomLineForm — egendefinert UE-splittlinje (egen pris, kun kost) ────────

/**
 * Legg til en budsjettlinje der en DEL av et produkt settes ut til en UE med
 * EGEN pris (ikke katalogprisen) — f.eks. «UPFA2303 - Blåsing». Salgsverdi = 0
 * (kun kost; kundeinntekten blir på hovedlinja), og linja tildeles UE-en direkte.
 * Hovedlinja settes til «Intern / MinUE» med den vanlige tildelingen.
 */
function CustomLineForm({
  projectId, products, subs, onRefresh,
}: {
  projectId: string
  products: Product[]
  subs: Subcontractor[]
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState({ product_id: '', label: '', qty: '', sub_id: '', ue_price: '' })
  const upd = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }))
  const reset = () => { setF({ product_id: '', label: '', qty: '', sub_id: '', ue_price: '' }); setError(null) }

  async function submit() {
    const qty = Number(f.qty.replace(',', '.'))
    const uePrice = Number(f.ue_price.replace(',', '.'))
    if (!f.product_id) { setError('Velg et produkt'); return }
    if (!Number.isFinite(qty) || qty < 0) { setError('Mengde må være et tall ≥ 0'); return }
    if (!f.sub_id) { setError('Velg underentreprenør'); return }
    if (!Number.isFinite(uePrice) || uePrice < 0) { setError('UE-pris må være et tall ≥ 0'); return }
    setError(null); setSaving(true)
    const res = await fetch('/api/budget-lines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        product_id: f.product_id,
        budget_quantity: qty,
        custom_label: f.label.trim(),
        customer_price: 0,                       // kun kost — kundeinntekt på hovedlinja
        subcontractor_cost_price: uePrice,
        assigned_subcontractor_id: f.sub_id,
        line_type: 'subcontractor_work',
      }),
    })
    const data = await res.json().catch(() => ({} as Record<string, unknown>))
    setSaving(false)
    if (!res.ok) { setError((data as { error?: string }).error ?? 'Lagring feilet'); return }
    reset()
    onRefresh()
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-1.5 border border-blue-300 text-blue-700 text-sm rounded hover:bg-blue-50"
      >
        + UE-splittlinje (egen pris)
      </button>
    )
  }

  const inputCls = 'text-sm text-[var(--color-text-primary)] border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-blue-500'

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit() }}
      className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex flex-wrap gap-4 items-end"
    >
      <div>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Produkt (kode/navn)</label>
        <select required value={f.product_id} onChange={(e) => upd({ product_id: e.target.value })} className={inputCls}>
          <option value="">Velg produkt</option>
          {products.map((p) => <option key={p.id} value={p.id}>{fmtProductLabel(p)} — {p.unit}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Etikett</label>
        <input value={f.label} onChange={(e) => upd({ label: e.target.value })} placeholder="f.eks. Blåsing" className={`${inputCls} w-36`} />
      </div>
      <div>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Mengde</label>
        <NumberInput value={f.qty} onChange={(raw) => upd({ qty: raw })} className={`${inputCls} w-24`} />
      </div>
      <div>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Underentreprenør</label>
        <select required value={f.sub_id} onChange={(e) => upd({ sub_id: e.target.value })} className={inputCls}>
          <option value="">Velg UE</option>
          {subs.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">UE-pris (kr/enhet)</label>
        <NumberInput value={f.ue_price} onChange={(raw) => upd({ ue_price: raw })} className={`${inputCls} w-28`} />
      </div>
      <button type="submit" disabled={saving} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Lagrer…' : 'Lagre linje'}
      </button>
      <button type="button" onClick={() => { setOpen(false); reset() }} className="px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:underline">
        Avbryt
      </button>
      {error && <p className="w-full text-xs font-medium text-red-600">{error}</p>}
      <p className="w-full text-[11px] text-[var(--color-text-muted)]">
        Salgsverdi settes til 0 (kun kost) — kundeinntekten blir på hovedlinja. Husk å sette hovedlinja til «Intern / MinUE».
      </p>
    </form>
  )
}

/**
 * "Budsjettlinjer"-tab: form for adding lines, Excel-import, filter +
 * bulk-assign UI, and the actual table with per-row expand → BudgetLineChart.
 *
 * BLRow building + columns + expanded-row render fn used to be helpers on
 * the parent (so both this tab AND the materiell tab could share them).
 * Materiell now receives prebuilt rows; we own the helpers here.
 */
export default function BudgetLinesSection({
  project,
  budgetLines,
  allProducts,
  allSubs,
  projectSubDetails,
  changeOrders,
  phases, phaseTypes, onAssignPhase,
  showAddLine, setShowAddLine,
  newLine, setNewLine,
  savingLine, onAddBudgetLine, onRefresh,
  selected, setSelected,
  bulkSubcontractor, setBulkSubcontractor,
  bulkError, onBulkAssign,
  allChecked, onToggleAll, onToggleRow,
  lineTypeFilter, setLineTypeFilter,
  chartLineId, setChartLineId,
  importFileRef, importing, importMsg, onImport,
  budgetVersions, dragOver, setDragOver,
}: Props) {

  const buildBLRows = (lines: ProjectBudgetLine[]): BLRow[] => lines.map((bl) => {
    const product = allProducts.find((p) => p.id === bl.product_id)
    const isIntern = bl.assigned_subcontractor_id === '__intern__'
    const assignedSub = isIntern ? null : allSubs.find((s) => s.id === bl.assigned_subcontractor_id)
    const salesValue = bl.budget_quantity * bl.customer_price_snapshot
    const costValue = bl.assigned_subcontractor_id && !isIntern
      ? bl.budget_quantity * bl.subcontractor_cost_price_snapshot
      : 0
    return {
      id: bl.id,
      product_code: product?.description ?? '–',
      product_name: bl.custom_label?.trim() || (product?.name ?? '–'),
      unit: product?.unit ?? '–',
      source: bl.source ?? 'manual',
      budget_quantity: bl.budget_quantity,
      customer_price_snapshot: bl.customer_price_snapshot,
      sales_value: salesValue,
      assigned_subcontractor_id: bl.assigned_subcontractor_id,
      assigned_name: isIntern ? 'Intern / MinUE' : (assignedSub?.company_name ?? ''),
      subcontractor_cost_price_snapshot: bl.subcontractor_cost_price_snapshot,
      cost_value: costValue,
      profit: salesValue - costValue,
      line_type: bl.line_type ?? 'subcontractor_work',
      phase_id: bl.phase_id ?? null,
    }
  })

  // Fase-etiketter for tagge-nedtrekket + sortering.
  const phaseTypeName = new Map(phaseTypes.map((t) => [t.id, t.name]))
  const phaseLabel = (p: ProjectPhase) => p.name || phaseTypeName.get(p.phase_type_id) || 'Fase'
  const phaseLabelById = new Map(phases.map((p) => [p.id, phaseLabel(p)]))

  const expandedRowRenderFn = (row: BLRow) => {
    const bl = budgetLines.find((b) => b.id === row.id)
    if (!bl) return null
    const product = allProducts.find((p) => p.id === bl.product_id)
    const sub = allSubs.find((s) => s.id === bl.assigned_subcontractor_id)
    const cos = changeOrders
      .filter((co) =>
        co.product_id === bl.product_id
        && co.subcontractor_id === bl.assigned_subcontractor_id
        && co.status === 'approved'
        && co.reviewed_at != null
      )
      .sort((a, b) => a.reviewed_at!.localeCompare(b.reviewed_at!))
    const coTotal = cos.reduce((s, co) => s + co.requested_quantity, 0)
    return (
      <BudgetLineChart
        productName={product?.name ?? row.product_name}
        productCode={product?.description}
        unit={product?.unit ?? row.unit}
        subName={sub?.company_name}
        importQty={bl.budget_quantity - coTotal}
        projectStart={project.start_date ?? ''}
        approvedCOs={cos}
      />
    )
  }

  const blColumns = [
    {
      key: 'select',
      label: '',
      render: (row: BLRow) => (
        <input
          type="checkbox"
          checked={selected.includes(row.id)}
          onChange={() => onToggleRow(row.id)}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4"
        />
      ),
    },
    { key: 'product_code', label: 'Kode', sortable: true },
    { key: 'product_name', label: 'Produkt', sortable: true, tdClassName: 'truncate max-w-0' },
    { key: 'unit', label: 'Enhet' },
    {
      key: 'line_type',
      label: 'Type',
      sortable: true,
      render: (row: BLRow) => {
        const colors: Record<string, string> = {
          subcontractor_work: 'bg-blue-50 text-blue-700',
          internal_cost: 'bg-indigo-50 text-indigo-700',
          material: 'bg-orange-50 text-orange-700',
        }
        return (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[row.line_type] ?? 'bg-muted text-[var(--color-text-secondary)]'}`}>
            {lineTypeLabel(row.line_type)}
          </span>
        )
      },
    },
    { key: 'budget_quantity', label: 'Mengde', sortable: true },
    { key: 'customer_price_snapshot', label: 'Utsalgspris', sortable: true, render: (row: BLRow) => fmt(row.customer_price_snapshot) },
    {
      key: 'sales_value',
      label: 'Salgsverdi',
      sortable: true,
      getValue: (row: BLRow) => row.sales_value,
      render: (row: BLRow) => <span className="font-medium">{fmt(row.sales_value)}</span>,
    },
    {
      key: 'assigned_subcontractor_id',
      label: 'Tildelt UE',
      sortable: true,
      getValue: (row: BLRow) => row.assigned_name,
      render: (row: BLRow) => row.assigned_subcontractor_id
        ? <span className="text-sm text-[var(--color-text-primary)]">{row.assigned_name}</span>
        : <span className="text-xs text-orange-400">Ikke tildelt</span>,
    },
    {
      key: 'phase_id',
      label: 'Fase',
      sortable: true,
      getValue: (row: BLRow) => (row.phase_id ? phaseLabelById.get(row.phase_id) ?? '' : ''),
      render: (row: BLRow) => (
        <select
          value={row.phase_id ?? ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onAssignPhase(row.id, e.target.value || null)}
          className="text-xs text-[var(--color-text-primary)] border border-border rounded px-1.5 py-1 bg-card max-w-[150px] focus:outline-none focus:border-primary"
        >
          <option value="">— Ingen —</option>
          {phases.map((p) => <option key={p.id} value={p.id}>{phaseLabel(p)}</option>)}
        </select>
      ),
    },
    {
      key: 'cost_value',
      label: 'Kostnad',
      sortable: true,
      getValue: (row: BLRow) => row.cost_value,
      render: (row: BLRow) => row.assigned_subcontractor_id ? fmt(row.cost_value) : '–',
    },
    {
      key: 'profit',
      label: 'Fortjeneste',
      sortable: true,
      getValue: (row: BLRow) => row.profit,
      render: (row: BLRow) => row.assigned_subcontractor_id
        ? <span className={row.profit >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{fmt(row.profit)}</span>
        : '–',
    },
  ]

  const allRows = buildBLRows(budgetLines)
  const filteredRows = lineTypeFilter === 'all'
    ? allRows
    : allRows.filter((r) => r.line_type === lineTypeFilter)

  // Sum-fot: summerer de SØKE-/filtrerte radene (SortableTable sender inn de
  // synlige radene). Lar deg slå opp f.eks. «UPFA2303» og se total salgsverdi +
  // mengde på tvers av flere poster og prisendringer. Justert under riktig kolonne.
  const renderBudgetSummary = (rows: BLRow[]) => {
    const sumQty = rows.reduce((s, r) => s + r.budget_quantity, 0)
    const sumSales = rows.reduce((s, r) => s + r.sales_value, 0)
    const sumCost = rows.reduce((s, r) => s + r.cost_value, 0)
    const sumProfit = rows.reduce((s, r) => s + (r.assigned_subcontractor_id ? r.profit : 0), 0)
    return (
      <tr className="border-t-2 border-border bg-muted/60 font-medium text-[var(--color-text-primary)]">
        <td className="px-3 py-2" />
        <td className="px-3 py-2 text-xs uppercase tracking-wide text-[var(--color-text-muted)] whitespace-nowrap" colSpan={2}>
          Sum · {rows.length} {rows.length === 1 ? 'post' : 'poster'}
        </td>
        <td />
        <td />
        <td className="px-3 py-2 tabular-nums">{sumQty.toLocaleString('nb-NO')}</td>
        <td />
        <td className="px-3 py-2 tabular-nums font-semibold">{fmt(sumSales)}</td>
        <td />
        <td />
        <td className="px-3 py-2 tabular-nums">{fmt(sumCost)}</td>
        <td className="px-3 py-2 tabular-nums">{fmt(sumProfit)}</td>
      </tr>
    )
  }

  return (
    <section className="space-y-6">
      {/* Budsjettversjonhistorikk + drag/drop Excel-import — moved here from
          Oversikt so all budget-related material lives on the same tab. */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-white rounded-xl shadow border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted">
            <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">Budsjettversjonhistorikk</h3>
          </div>
          {budgetVersions.length === 0 ? (
            <div className="px-5 py-6 text-sm text-[var(--color-text-muted)] text-center">Ingen budsjettfiler lastet opp ennå.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase text-left">Versjon</th>
                    <th className="px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase text-right">Salgsverdi</th>
                    <th className="px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase text-right">Kostnad</th>
                    <th className="px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase text-right">Fortjeneste</th>
                    <th className="px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase text-right">Endring</th>
                    <th className="px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase text-left">Lastet opp</th>
                    <th className="px-5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase text-center">Fil</th>
                  </tr>
                </thead>
                <tbody>
                  {budgetVersions.map((bver, idx) => {
                    const prev = idx > 0 ? budgetVersions[idx - 1] : null
                    const delta = prev != null ? bver.total_sales_value - prev.total_sales_value : null
                    const profit = bver.total_sales_value - bver.total_cost_value
                    const isLatest = idx === budgetVersions.length - 1
                    const label = bver.version === 0 ? 'Originalbudsjett' : `V${bver.version}`
                    const dateStr = new Date(bver.uploaded_at).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })
                    const timeStr = new Date(bver.uploaded_at).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
                    return (
                      <tr key={bver.id} className={`border-b border-border ${isLatest ? 'bg-blue-50' : 'hover:bg-muted'}`}>
                        <td className="px-5 py-3">
                          <span className={`font-medium ${isLatest ? 'text-blue-700' : 'text-[var(--color-text-primary)]'}`}>{label}</span>
                          {isLatest && <span className="ml-2 text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-medium">Gjeldende</span>}
                        </td>
                        <td className="px-5 py-3 text-right text-[var(--color-text-secondary)]">{fmt(bver.total_sales_value)}</td>
                        <td className="px-5 py-3 text-right text-[var(--color-text-secondary)]">{fmt(bver.total_cost_value)}</td>
                        <td className={`px-5 py-3 text-right font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(profit)}</td>
                        <td className="px-5 py-3 text-right">
                          {delta == null ? (
                            <span className="text-gray-300">—</span>
                          ) : (
                            <span className={`font-medium text-xs ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-[var(--color-text-muted)]'}`}>
                              {delta > 0 ? '+' : ''}{fmt(delta)}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="text-[var(--color-text-secondary)]">{bver.uploaded_by}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{dateStr} {timeStr}</div>
                        </td>
                        <td className="px-5 py-3 text-center">
                          {bver.file_name ? (
                            <a href={`/api/budget-versions/${bver.id}/file`} download title="Last ned Excel-fil" className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-green-100 text-green-600 hover:text-green-700 transition-colors">
                              <Download size={14} />
                            </a>
                          ) : (
                            <span className="text-gray-300 text-xs">–</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Drag-and-drop Excel-import card */}
        <div
          onClick={() => !importing && importFileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragEnter={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false)
            const file = e.dataTransfer.files?.[0]
            if (file) onImport(file)
          }}
          className={`rounded-xl p-6 flex flex-col items-center justify-center text-center gap-4 cursor-pointer transition-colors border-2 border-dashed select-none ${dragOver ? 'bg-blue-100 border-blue-500' : importing ? 'bg-blue-50 border-blue-200 cursor-default' : 'bg-blue-50 border-blue-300 hover:bg-blue-100 hover:border-blue-400'}`}
        >
          <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${dragOver ? 'bg-blue-200' : 'bg-blue-100'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-7 h-7 transition-colors ${dragOver ? 'text-blue-700' : 'text-blue-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 12V4m0 0L8 8m4-4l4 4" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-blue-900 text-base">{importing ? 'Importerer...' : dragOver ? 'Slipp filen her' : 'Last inn oppdatert budsjettfil'}</p>
            <p className="text-sm text-blue-700 mt-1 max-w-xs">{importing ? 'Behandler Excel-filen…' : 'Dra og slipp en .xlsx-fil hit, eller klikk for å velge'}</p>
          </div>
          {!importing && <span className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm pointer-events-none">Velg fil</span>}
          {importMsg && <p className={`text-xs font-medium ${importMsg.toLowerCase().includes('feil') ? 'text-red-600' : 'text-green-600'}`}>{importMsg}</p>}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Budsjett</h2>
        <div className="flex gap-2 items-center">
          {/* handlePostImport builds messages like "3 nye linjer · 1 oppdatert" on success,
              or "<error>"/"Import feilet" on failure — pick color by "feil" substring. */}
          {importMsg && (
            <span className={`text-xs ${importMsg.toLowerCase().includes('feil') ? 'text-red-600' : 'text-green-600'}`}>
              {importMsg}
            </span>
          )}
          <button
            onClick={() => importFileRef.current?.click()}
            disabled={importing}
            className="px-3 py-1.5 bg-muted text-[var(--color-text-secondary)] text-sm rounded hover:bg-gray-200 disabled:opacity-50"
          >
            {importing ? 'Importerer...' : '↑ Importer fra Excel'}
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { onImport(f); e.target.value = '' } }}
          />
          <button
            onClick={() => setShowAddLine((v) => !v)}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            {showAddLine ? 'Avbryt' : '+ Legg til linje'}
          </button>
        </div>
      </div>

      {showAddLine && (
        <form onSubmit={onAddBudgetLine} className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Produkt</label>
            <select
              required
              value={newLine.product_id}
              onChange={(e) => setNewLine((p) => ({ ...p, product_id: e.target.value }))}
              className="text-sm text-[var(--color-text-primary)] border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-blue-500"
            >
              <option value="">Velg produkt</option>
              {allProducts.map((p) => <option key={p.id} value={p.id}>{fmtProductLabel(p)} — {p.unit}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Mengde</label>
            <NumberInput
              required
              value={newLine.budget_quantity}
              onChange={(raw) => setNewLine((p) => ({ ...p, budget_quantity: raw }))}
              className="w-28 px-2 py-1.5 text-sm text-[var(--color-text-primary)] border border-border rounded focus:outline-none focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Type</label>
            <select
              value={newLine.line_type}
              onChange={(e) => setNewLine((p) => ({ ...p, line_type: e.target.value }))}
              className="text-sm text-[var(--color-text-primary)] border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-blue-500"
            >
              <option value="subcontractor_work">UE-arbeid</option>
              <option value="internal_cost">Intern</option>
              <option value="material">Materiell</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={savingLine}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {savingLine ? 'Lagrer...' : 'Lagre'}
          </button>
        </form>
      )}

      <div className="flex">
        <CustomLineForm
          projectId={project.id}
          products={allProducts}
          subs={projectSubDetails}
          onRefresh={onRefresh}
        />
      </div>

      {bulkError && (
        <div className="px-4 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {bulkError}
        </div>
      )}

      {/* Filter + bulk assign */}
      <div className="flex flex-wrap items-center gap-3 p-2 bg-muted border border-border rounded">
        <input type="checkbox" checked={allChecked} onChange={onToggleAll} className="h-4 w-4" title="Velg alle" />
        <span className="text-sm text-[var(--color-text-muted)]">
          {selected.length > 0 ? `${selected.length} valgt` : 'Velg rader'}
        </span>
        {selected.length > 0 && (
          <>
            <select
              value={bulkSubcontractor}
              onChange={(e) => setBulkSubcontractor(e.target.value)}
              className="text-sm border border-border rounded px-2 py-1"
            >
              <option value="">— Velg underentreprenør —</option>
              <option value="__intern__">Intern / MinUE</option>
              {projectSubDetails.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
            </select>
            <button
              onClick={onBulkAssign}
              disabled={!bulkSubcontractor}
              className="text-sm bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-40"
            >
              Tildel
            </button>
            <button onClick={() => setSelected(() => [])} className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
              Avbryt
            </button>
          </>
        )}
      </div>

      <div className="bg-white rounded-lg shadow">
        <SortableTable
          columns={blColumns}
          data={filteredRows}
          emptyText="Ingen budsjettlinjer ennå"
          tableClassName="table-fixed"
          colWidths={['w-8', 'w-24', undefined, 'w-16', 'w-24', 'w-20', 'w-24', 'w-28', 'w-36', 'w-40', 'w-28', 'w-28']}
          rowClassName={(row: BLRow) => row.assigned_subcontractor_id
            ? 'border-b border-border hover:bg-blue-50'
            : 'border-b border-orange-100 bg-orange-50 hover:bg-orange-100'}
          expandedRowId={chartLineId}
          onRowExpand={(rowId) => setChartLineId(rowId)}
          expandedRowRender={expandedRowRenderFn}
          searchable
          searchPlaceholder="Søk i budsjettlinjer …"
          getSearchText={(row) => `${row.product_code} ${row.product_name}`}
          renderSummary={renderBudgetSummary}
          toolbar={
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-text-muted)]">Filtrer type:</span>
              <select
                value={lineTypeFilter}
                onChange={(e) => setLineTypeFilter(e.target.value)}
                className="text-sm border border-border rounded px-2 py-1"
              >
                <option value="all">Alle</option>
                <option value="subcontractor_work">UE-arbeid</option>
                <option value="internal_cost">Intern</option>
                <option value="material">Materiell</option>
              </select>
            </div>
          }
        />
      </div>
    </section>
  )
}
