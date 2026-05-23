'use client'

import SortableTable from '@/components/SortableTable'
import { reportLineStatus } from '@/lib/statuses'
import type { ReportLine, ProjectBudgetLine, Product, Subcontractor } from '@/types'

interface Props {
  reportLines: ReportLine[]
  budgetLines: ProjectBudgetLine[]
  allProducts: Product[]
  allSubs: Subcontractor[]
  onUpdateStatus: (id: string, status: 'approved' | 'rejected') => void
}

type RLRow = {
  id: string
  product_code: string
  product_name: string
  sub_name: string
  quantity_str: string
  report_date: string
  status: string
}

/**
 * Read-only list of all single-row reports for this project. Admins can
 * approve/reject submitted rows inline; everything else is just rendering.
 * Pulled out of the 1.2k-line parent page so its UI is editable in isolation.
 */
export default function ReportingsSection({ reportLines, budgetLines, allProducts, allSubs, onUpdateStatus }: Props) {
  const rlRows: RLRow[] = reportLines.map((rl) => {
    const bl = budgetLines.find((b) => b.id === rl.project_budget_line_id)
    const product = allProducts.find((p) => p.id === bl?.product_id)
    const sub = allSubs.find((s) => s.id === rl.subcontractor_id)
    return {
      id: rl.id,
      product_code: product?.description ?? '–',
      product_name: product?.name ?? '–',
      sub_name: sub?.company_name ?? '–',
      quantity_str: `${rl.reported_quantity} ${product?.unit ?? ''}`,
      report_date: rl.report_date,
      status: rl.status,
    }
  })

  const rlColumns = [
    { key: 'product_code', label: 'Kode', sortable: true },
    { key: 'product_name', label: 'Produkt', sortable: true },
    { key: 'sub_name', label: 'Underentreprenør', sortable: true },
    { key: 'quantity_str', label: 'Mengde' },
    { key: 'report_date', label: 'Dato', sortable: true },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (row: RLRow) => {
        const meta = reportLineStatus(row.status)
        return <span className={`text-xs px-2 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
      },
    },
    {
      key: 'actions',
      label: '',
      render: (row: RLRow) => row.status === 'submitted' ? (
        <div className="flex gap-2">
          <button onClick={() => onUpdateStatus(row.id, 'approved')} className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700">Godkjenn</button>
          <button onClick={() => onUpdateStatus(row.id, 'rejected')} className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700">Avvis</button>
        </div>
      ) : null,
    },
  ]

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Rapporteringer</h2>
      <div className="bg-white rounded-lg shadow">
        <SortableTable columns={rlColumns} data={rlRows} emptyText="Ingen rapporteringer ennå" />
      </div>
    </section>
  )
}
