'use client'
import React, { useState } from 'react'

type SortDirection = 'asc' | 'desc' | null

export interface Column<T> {
  key: string
  label: React.ReactNode
  sortable?: boolean
  render?: (row: T) => React.ReactNode
  getValue?: (row: T) => string | number | Date
  tdClassName?: string
}

interface Props<T extends { id: string }> {
  columns: Column<T>[]
  data: T[]
  emptyText?: string
  tableClassName?: string
  colWidths?: (string | undefined)[]
  rowClassName?: (row: T) => string
  onRowClick?: (row: T) => void
  expandedRowId?: string | null
  onRowExpand?: (id: string | null) => void
  expandedRowRender?: (row: T) => React.ReactNode
}

export default function SortableTable<T extends { id: string }>({ columns, data, emptyText, tableClassName, colWidths, rowClassName, onRowClick, expandedRowId, onRowExpand, expandedRowRender }: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDirection>(null)

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc'))
      if (sortDir === 'desc') setSortKey(null)
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = [...data].sort((a, b) => {
    if (!sortKey || !sortDir) return 0
    const col = columns.find((c) => c.key === sortKey)
    const av = col?.getValue ? col.getValue(a) : (a as Record<string, unknown>)[sortKey]
    const bv = col?.getValue ? col.getValue(b) : (b as Record<string, unknown>)[sortKey]
    if (av == null || bv == null) return 0
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-sm${tableClassName ? ` ${tableClassName}` : ''}`}>
        {colWidths && (
          <colgroup>
            {colWidths.map((w, i) => <col key={i} className={w ?? ''} />)}
          </colgroup>
        )}
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => col.sortable && handleSort(col.key)}
                className={`px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide whitespace-nowrap ${col.sortable ? 'cursor-pointer select-none hover:text-[var(--color-text-primary)]' : ''}`}
              >
                {col.label}
                {col.sortable && sortKey === col.key && (
                  <span className="ml-1 text-[var(--color-text-muted)]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-[var(--color-text-muted)] text-sm">
                {emptyText ?? 'Ingen data'}
              </td>
            </tr>
          )}
          {sorted.map((row) => {
            const isExpanded = expandedRowId === row.id
            const handleClick = () => {
              if (expandedRowRender && onRowExpand) {
                onRowExpand(isExpanded ? null : row.id)
              } else {
                onRowClick?.(row)
              }
            }
            return (
              <React.Fragment key={row.id}>
                <tr
                  onClick={handleClick}
                  className={`${rowClassName ? rowClassName(row) : 'border-b border-border hover:bg-muted'}${(expandedRowRender || onRowClick) ? ' cursor-pointer' : ''}`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-3 py-2 text-sm text-[var(--color-text-secondary)]${col.tdClassName ? ` ${col.tdClassName}` : ''}`}>
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
                {isExpanded && expandedRowRender && (
                  <tr className="bg-muted">
                    <td colSpan={columns.length} className="px-0 py-0">
                      {expandedRowRender(row)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
