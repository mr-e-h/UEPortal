'use client'

import { useState } from 'react'
import SortableTable from '@/components/SortableTable'
import { weeklyReportLineStatus } from '@/lib/statuses'
import type { ProjectBudgetLine, Product, Subcontractor } from '@/types'
import type { WRWithLines } from './useProjectData'

interface Props {
  weeklyReports: WRWithLines[]
  budgetLines: ProjectBudgetLine[]
  allProducts: Product[]
  allSubs: Subcontractor[]
}

type WRRow = {
  id: string
  product_code: string
  product_name: string
  sub_name: string
  week_label: string
  week_sort: number
  quantity_str: string
  submitted: string
  status: string
}

/**
 * Prosjektets ukesrapport-linjer (read-only). Flater ut weekly_report_lines per
 * rapport → én rad per rapportert produkt, med uke + status. Godkjenning skjer
 * på /admin/weekly-reports (egen side); her er det kun visning. 0-mengde-linjer
 * (artefakter fra prisperiode-/underprodukt-grupperingen) skjules. (Den gamle
 * report_lines-modulen var tom for nye prosjekter — denne fanen viser nå de
 * faktiske rapporteringene.)
 */
export default function ReportingsSection({ weeklyReports, budgetLines, allProducts, allSubs }: Props) {
  const [statusFilter, setStatusFilter] = useState('all')

  const blById = new Map(budgetLines.map((b) => [b.id, b]))
  const productById = new Map(allProducts.map((p) => [p.id, p]))
  const subById = new Map(allSubs.map((s) => [s.id, s]))

  const rows: WRRow[] = weeklyReports
    .flatMap((wr) =>
      wr.lines
        .filter((l) => l.reported_quantity !== 0)
        .map((l) => {
          const bl = blById.get(l.project_budget_line_id)
          const product = bl ? productById.get(bl.product_id) : undefined
          const sub = subById.get(wr.subcontractor_id)
          return {
            id: l.id,
            product_code: product?.description ?? '–',
            product_name: bl?.custom_label?.trim() || product?.name || '–',
            sub_name: sub?.company_name ?? '–',
            week_label: `Uke ${wr.week_number} · ${wr.year}`,
            week_sort: wr.year * 100 + wr.week_number,
            quantity_str: `${l.reported_quantity} ${product?.unit ?? ''}`,
            submitted: wr.submitted_at ? new Date(wr.submitted_at).toLocaleDateString('nb-NO') : '–',
            status: l.status,
          }
        }),
    )
    .filter((r) => statusFilter === 'all' || r.status === statusFilter)

  const columns = [
    { key: 'product_code', label: 'Kode', sortable: true },
    { key: 'product_name', label: 'Produkt', sortable: true },
    { key: 'sub_name', label: 'Underentreprenør', sortable: true },
    { key: 'week_label', label: 'Uke', sortable: true, getValue: (r: WRRow) => r.week_sort },
    { key: 'quantity_str', label: 'Mengde' },
    { key: 'submitted', label: 'Innsendt', sortable: true },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (r: WRRow) => {
        const meta = weeklyReportLineStatus(r.status)
        return <span className={`text-xs px-2 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
      },
    },
  ]

  const statusToolbar = (
    <select
      value={statusFilter}
      onChange={(e) => setStatusFilter(e.target.value)}
      className="text-sm text-[var(--color-text-primary)] border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      <option value="all">Alle statuser</option>
      <option value="pending">Venter</option>
      <option value="approved">Godkjent</option>
      <option value="rejected">Avvist</option>
    </select>
  )

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Rapporteringer</h2>
        <a href="/admin/weekly-reports" className="text-sm text-primary hover:underline">Til godkjenning av ukesrapporter →</a>
      </div>
      <div className="bg-white rounded-lg shadow px-3 pt-3">
        <SortableTable
          columns={columns}
          data={rows}
          emptyText="Ingen rapporteringer ennå"
          searchable
          searchPlaceholder="Søk i rapporteringer …"
          getSearchText={(row) => `${row.product_code} ${row.product_name} ${row.sub_name} ${row.week_label}`}
          toolbar={statusToolbar}
        />
      </div>
    </section>
  )
}
