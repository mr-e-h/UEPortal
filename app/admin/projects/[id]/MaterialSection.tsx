'use client'

import SortableTable, { type Column } from '@/components/SortableTable'

interface BLRowLike { id: string }

interface Props<R extends BLRowLike> {
  rows: R[]
  columns: Column<R>[]
  expandedRowId: string | null
  onRowExpand: (id: string | null) => void
  expandedRowRender: (row: R) => React.ReactNode
  onGoToBudgetLines: () => void
}

/**
 * "Materiell"-tab. Renders the precomputed material budget-line rows from
 * the parent (parent already builds + memos them for the main "Budsjettlinjer"
 * table too). Empty state nudges admin to add lines on the other tab.
 */
export default function MaterialSection<R extends BLRowLike>({
  rows,
  columns,
  expandedRowId,
  onRowExpand,
  expandedRowRender,
  onGoToBudgetLines,
}: Props<R>) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Materiell</h2>
        <span className="text-xs text-gray-400">Viser budsjettlinjer av type «Materiell»</span>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-400">Ingen materiell-linjer lagt til ennå.</p>
          <p className="text-xs text-gray-400 mt-1">
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
            rowClassName={() => 'border-b border-gray-100 hover:bg-orange-50'}
            expandedRowId={expandedRowId}
            onRowExpand={onRowExpand}
            expandedRowRender={expandedRowRender}
          />
        </div>
      )}
    </section>
  )
}
