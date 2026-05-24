'use client'

import { type RefObject } from 'react'
import dynamic from 'next/dynamic'
import SortableTable from '@/components/SortableTable'
import NumberInput from '@/components/NumberInput'
import { fmtNOK as fmt } from '@/lib/format'
import { lineTypeLabel } from '@/lib/line-types'
import type { ProjectBudgetLine, Product, Subcontractor, ChangeOrder, Project } from '@/types'

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
}

interface Props {
  project: Project
  budgetLines: ProjectBudgetLine[]
  allProducts: Product[]
  allSubs: Subcontractor[]
  projectSubDetails: Subcontractor[]
  changeOrders: ChangeOrder[]

  // form state — owned by parent so it survives tab switches
  showAddLine: boolean
  setShowAddLine: (v: boolean | ((prev: boolean) => boolean)) => void
  newLine: { product_id: string; budget_quantity: string; line_type: string }
  setNewLine: (updater: (prev: { product_id: string; budget_quantity: string; line_type: string }) => { product_id: string; budget_quantity: string; line_type: string }) => void
  savingLine: boolean
  onAddBudgetLine: (e: React.FormEvent) => void

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
  showAddLine, setShowAddLine,
  newLine, setNewLine,
  savingLine, onAddBudgetLine,
  selected, setSelected,
  bulkSubcontractor, setBulkSubcontractor,
  bulkError, onBulkAssign,
  allChecked, onToggleAll, onToggleRow,
  lineTypeFilter, setLineTypeFilter,
  chartLineId, setChartLineId,
  importFileRef, importing, importMsg, onImport,
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
      product_name: product?.name ?? '–',
      unit: product?.unit ?? '–',
      source: bl.source ?? 'manual',
      budget_quantity: bl.budget_quantity,
      customer_price_snapshot: bl.customer_price_snapshot,
      sales_value: salesValue,
      assigned_subcontractor_id: bl.assigned_subcontractor_id,
      assigned_name: isIntern ? 'Intern / Netel' : (assignedSub?.company_name ?? ''),
      subcontractor_cost_price_snapshot: bl.subcontractor_cost_price_snapshot,
      cost_value: costValue,
      profit: salesValue - costValue,
      line_type: bl.line_type ?? 'subcontractor_work',
    }
  })

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
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[row.line_type] ?? 'bg-gray-100 text-gray-600'}`}>
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
        ? <span className="text-sm text-gray-900">{row.assigned_name}</span>
        : <span className="text-xs text-orange-400">Ikke tildelt</span>,
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

  return (
    <section className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">Budsjettlinjer</h2>
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
            className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 disabled:opacity-50"
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
            <label className="block text-xs font-medium text-gray-700 mb-1">Produkt</label>
            <select
              required
              value={newLine.product_id}
              onChange={(e) => setNewLine((p) => ({ ...p, product_id: e.target.value }))}
              className="text-sm text-gray-900 border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-blue-500"
            >
              <option value="">Velg produkt</option>
              {allProducts.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.unit}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Mengde</label>
            <NumberInput
              required
              value={newLine.budget_quantity}
              onChange={(raw) => setNewLine((p) => ({ ...p, budget_quantity: raw }))}
              className="w-28 px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
            <select
              value={newLine.line_type}
              onChange={(e) => setNewLine((p) => ({ ...p, line_type: e.target.value }))}
              className="text-sm text-gray-900 border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-blue-500"
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

      {bulkError && (
        <div className="px-4 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {bulkError}
        </div>
      )}

      {/* Filter + bulk assign */}
      <div className="flex flex-wrap items-center gap-3 p-2 bg-gray-50 border border-gray-200 rounded">
        <input type="checkbox" checked={allChecked} onChange={onToggleAll} className="h-4 w-4" title="Velg alle" />
        <span className="text-sm text-gray-500">
          {selected.length > 0 ? `${selected.length} valgt` : 'Velg rader'}
        </span>
        {selected.length > 0 && (
          <>
            <select
              value={bulkSubcontractor}
              onChange={(e) => setBulkSubcontractor(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1"
            >
              <option value="">— Velg underentreprenør —</option>
              <option value="__intern__">Intern / Netel</option>
              {projectSubDetails.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
            </select>
            <button
              onClick={onBulkAssign}
              disabled={!bulkSubcontractor}
              className="text-sm bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-40"
            >
              Tildel
            </button>
            <button onClick={() => setSelected(() => [])} className="text-sm text-gray-500 hover:text-gray-700">
              Avbryt
            </button>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500">Filtrer type:</span>
          <select
            value={lineTypeFilter}
            onChange={(e) => setLineTypeFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1"
          >
            <option value="all">Alle</option>
            <option value="subcontractor_work">UE-arbeid</option>
            <option value="internal_cost">Intern</option>
            <option value="material">Materiell</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <SortableTable
          columns={blColumns}
          data={filteredRows}
          emptyText="Ingen budsjettlinjer ennå"
          tableClassName="table-fixed"
          colWidths={['w-8', 'w-24', undefined, 'w-16', 'w-24', 'w-20', 'w-24', 'w-28', 'w-36', 'w-28', 'w-28']}
          rowClassName={(row: BLRow) => row.assigned_subcontractor_id
            ? 'border-b border-gray-100 hover:bg-blue-50'
            : 'border-b border-orange-100 bg-orange-50 hover:bg-orange-100'}
          expandedRowId={chartLineId}
          onRowExpand={(rowId) => setChartLineId(rowId)}
          expandedRowRender={expandedRowRenderFn}
        />
      </div>
    </section>
  )
}
