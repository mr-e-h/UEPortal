'use client'

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
}: Props) {
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
