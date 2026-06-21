'use client'

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import SortableTable from '@/components/SortableTable'
import { fmtNOK as fmt } from '@/lib/format'
import type { ProjectBudgetLine, Product, Subcontractor, ChangeOrder, Project } from '@/types'

const BudgetLineChart = dynamic(() => import('@/components/BudgetLineChart'), { ssr: false })

type MaterialRow = {
  id: string
  product_code: string
  product_name: string
  unit: string
  budget_quantity: number
  customer_price_snapshot: number
  sales_value: number
  assigned_name: string
  subcontractor_cost_price_snapshot: number
  cost_value: number
  profit: number
  source: string
  // raw refs kept for expand-row chart
  product_id: string
  assigned_subcontractor_id: string | null
}

interface Props {
  project: Project
  budgetLines: ProjectBudgetLine[]
  allProducts: Product[]
  allSubs: Subcontractor[]
  changeOrders: ChangeOrder[]
  chartLineId: string | null
  setChartLineId: (id: string | null) => void
  onGoToBudgetLines: () => void
  onImported: () => void
}

type ImportResult = {
  ok?: boolean
  error?: string
  added?: number
  updated?: number
  new_products?: number
  skipped?: { row: number; code: string; name: string; reason: string }[]
}

/**
 * "Materiell"-tab. Builds its own row list from raw budgetLines filtered
 * to line_type='material'. Used to share helpers with the parent;
 * standalone now after BudgetLinesSection took the bulk-assign over.
 */
export default function MaterialSection({
  project,
  budgetLines,
  allProducts,
  allSubs,
  changeOrders,
  chartLineId,
  setChartLineId,
  onGoToBudgetLines,
  onImported,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState('')

  async function handleMaterialFile(file: File) {
    if (!file.name.endsWith('.xlsx')) {
      setImportError('Kun .xlsx-filer støttes')
      return
    }
    setImporting(true)
    setImportError('')
    setImportResult(null)

    const fd = new FormData()
    fd.append('file', file)
    let res: Response
    try {
      res = await fetch(`/api/projects/${project.id}/import-materials`, { method: 'POST', body: fd })
    } catch {
      setImportError('Nettverksfeil — prøv igjen')
      setImporting(false)
      return
    }

    const data = await res.json() as ImportResult
    if (!res.ok) {
      setImportError(data.error ?? 'Import feilet')
      setImporting(false)
      return
    }

    setImportResult(data)
    setImporting(false)
    onImported()
  }
  const rows: MaterialRow[] = budgetLines
    .filter((bl) => bl.line_type === 'material')
    .map((bl) => {
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
        budget_quantity: bl.budget_quantity,
        customer_price_snapshot: bl.customer_price_snapshot,
        sales_value: salesValue,
        assigned_name: isIntern ? 'Intern / MinUE' : (assignedSub?.company_name ?? ''),
        subcontractor_cost_price_snapshot: bl.subcontractor_cost_price_snapshot,
        cost_value: costValue,
        profit: salesValue - costValue,
        source: bl.source ?? 'manual',
        product_id: bl.product_id,
        assigned_subcontractor_id: bl.assigned_subcontractor_id,
      }
    })

  const columns = [
    { key: 'product_code', label: 'Kode', sortable: true },
    { key: 'product_name', label: 'Produkt', sortable: true },
    { key: 'unit', label: 'Enhet' },
    { key: 'budget_quantity', label: 'Mengde', sortable: true },
    { key: 'customer_price_snapshot', label: 'Utsalgspris', sortable: true, render: (row: MaterialRow) => fmt(row.customer_price_snapshot) },
    {
      key: 'sales_value',
      label: 'Salgsverdi',
      sortable: true,
      getValue: (row: MaterialRow) => row.sales_value,
      render: (row: MaterialRow) => <span className="font-medium">{fmt(row.sales_value)}</span>,
    },
    {
      key: 'assigned_name',
      label: 'Tildelt UE',
      sortable: true,
      render: (row: MaterialRow) => row.assigned_subcontractor_id
        ? <span className="text-sm text-[var(--color-text-primary)]">{row.assigned_name}</span>
        : <span className="text-xs text-orange-400">Ikke tildelt</span>,
    },
    {
      key: 'cost_value',
      label: 'Kostnad',
      sortable: true,
      getValue: (row: MaterialRow) => row.cost_value,
      render: (row: MaterialRow) => row.assigned_subcontractor_id ? fmt(row.cost_value) : '–',
    },
    {
      key: 'profit',
      label: 'Fortjeneste',
      sortable: true,
      getValue: (row: MaterialRow) => row.profit,
      render: (row: MaterialRow) => row.assigned_subcontractor_id
        ? <span className={row.profit >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{fmt(row.profit)}</span>
        : '–',
    },
  ]

  const expandedRowRender = (row: MaterialRow) => {
    const product = allProducts.find((p) => p.id === row.product_id)
    const sub = allSubs.find((s) => s.id === row.assigned_subcontractor_id)
    const cos = changeOrders
      .filter((co) =>
        co.product_id === row.product_id
        && co.subcontractor_id === row.assigned_subcontractor_id
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
        importQty={row.budget_quantity - coTotal}
        projectStart={project.start_date ?? ''}
        approvedCOs={cos}
      />
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Materiell</h2>
        <span className="text-xs text-[var(--color-text-muted)]">Viser budsjettlinjer av type «Materiell»</span>
      </div>

      {/* Material import */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">Last opp materielliste (.xlsx)</p>
        <div
          className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-border hover:border-blue-400 hover:bg-muted'}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files[0]
            if (file) handleMaterialFile(file)
          }}
        >
          {importing ? (
            <p className="text-sm text-blue-600">Importerer...</p>
          ) : importResult?.ok ? (
            <p className="text-sm text-green-600 font-medium">
              {((importResult.added ?? 0) + (importResult.updated ?? 0))} materiell-linjer importert
              {(importResult.new_products ?? 0) > 0 && ` · ${importResult.new_products} nye produkter`}
              {(importResult.updated ?? 0) > 0 && ` (${importResult.updated} oppdatert)`}
              {' — last opp ny fil for å erstatte'}
            </p>
          ) : (
            <>
              <p className="text-sm text-[var(--color-text-muted)]">Dra og slipp .xlsx-fil hit, eller klikk for å velge</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Legger til materiell-linjer i eksisterende budsjett</p>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMaterialFile(f); e.target.value = '' }}
        />

        {importResult?.ok && importResult.skipped && importResult.skipped.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            <p className="text-sm font-medium text-amber-800">
              {importResult.skipped.length} {importResult.skipped.length === 1 ? 'rad ble hoppet over' : 'rader ble hoppet over'} — kontroller at ingen av disse skulle vært med:
            </p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800 max-h-40 overflow-auto">
              {importResult.skipped.map((s, i) => (
                <li key={i}>Rad {s.row}: {s.name || s.code || '(uten navn)'} — {s.reason}</li>
              ))}
            </ul>
          </div>
        )}

        {importError && (
          <p className="text-sm text-red-600">{importError}</p>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">Ingen materiell-linjer lagt til ennå.</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Gå til{' '}
            <button className="text-blue-600 hover:underline" onClick={onGoToBudgetLines}>
              Budsjettlinjer
            </button>{' '}
            og legg til linjer av type «Materiell».
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <SortableTable
            columns={columns}
            data={rows}
            emptyText="Ingen materiell-linjer"
            rowClassName={() => 'border-b border-border hover:bg-orange-50'}
            expandedRowId={chartLineId}
            onRowExpand={(rowId) => setChartLineId(rowId)}
            expandedRowRender={expandedRowRender}
            searchable
            searchPlaceholder="Søk i materiell …"
            getSearchText={(row) => `${row.product_code} ${row.product_name}`}
          />
        </div>
      )}
    </section>
  )
}
