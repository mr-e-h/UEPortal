'use client'
import React, { useMemo, useState } from 'react'

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
  /** Vis et innebygd søkefelt over tabellen som filtrerer radene (substring). */
  searchable?: boolean
  /** Placeholder i søkefeltet (default «Søk …»). */
  searchPlaceholder?: string
  /**
   * Teksten en rad matches mot ved søk. Default: konkatener alle kolonners
   * getValue / render-string / row[key]. Gi denne for å styre nøyaktig hva
   * det søkes i (f.eks. bare produktnavn + kode).
   */
  getSearchText?: (row: T) => string
  /**
   * Egendefinerte filter-kontroller (f.eks. status-dropdowns) som rendres i
   * samme rad som søkefeltet, til høyre. Seksjonen eier filtrerings-logikken
   * og sender inn allerede-filtrert `data`; dette er kun plassering av UI.
   */
  toolbar?: React.ReactNode
  /** Valgfri sum-fot: får de filtrerte+sorterte radene og returnerer en <tr> som
   *  rendres i <tfoot> — f.eks. for å summere salgsverdi for søketreffene. */
  renderSummary?: (rows: T[]) => React.ReactNode
}

/** Fallback-søketekst: slå sammen alle kolonneverdier til én streng. */
function defaultSearchText<T extends { id: string }>(row: T, columns: Column<T>[]): string {
  return columns
    .map((col) => {
      if (col.getValue) {
        const v = col.getValue(row)
        return v instanceof Date ? v.toISOString() : String(v ?? '')
      }
      const raw = (row as Record<string, unknown>)[col.key]
      return raw == null ? '' : String(raw)
    })
    .join(' ')
}

export default function SortableTable<T extends { id: string }>({ columns, data, emptyText, tableClassName, colWidths, rowClassName, onRowClick, expandedRowId, onRowExpand, expandedRowRender, searchable, searchPlaceholder, getSearchText, toolbar, renderSummary }: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDirection>(null)
  const [query, setQuery] = useState('')

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc'))
      if (sortDir === 'desc') setSortKey(null)
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // Søk filtrerer FØR sortering. Tom spørring = alle rader.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!searchable || !q) return data
    return data.filter((row) => {
      const text = getSearchText ? getSearchText(row) : defaultSearchText(row, columns)
      return text.toLowerCase().includes(q)
    })
  }, [data, query, searchable, getSearchText, columns])

  const sorted = [...filtered].sort((a, b) => {
    if (!sortKey || !sortDir) return 0
    const col = columns.find((c) => c.key === sortKey)
    const av = col?.getValue ? col.getValue(a) : (a as Record<string, unknown>)[sortKey]
    const bv = col?.getValue ? col.getValue(b) : (b as Record<string, unknown>)[sortKey]
    if (av == null || bv == null) return 0
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const showToolbarRow = searchable || toolbar

  return (
    <>
      {showToolbarRow && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {searchable && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder ?? 'Søk …'}
              className="w-full max-w-xs px-3 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-[var(--color-text-primary)]"
            />
          )}
          {toolbar && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{toolbar}</div>}
        </div>
      )}
      <div className="overflow-x-auto">
      <table className={`w-full text-sm${tableClassName ? ` ${tableClassName}` : ''}`}>
        {colWidths && (
          <colgroup>
            {colWidths.map((w, i) => <col key={i} className={w ?? ''} />)}
          </colgroup>
        )}
        <thead>
          <tr className="border-b border-border bg-muted/60">
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => col.sortable && handleSort(col.key)}
                className={`px-3 py-1.5 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide whitespace-nowrap ${col.sortable ? 'cursor-pointer select-none hover:text-[var(--color-text-primary)]' : ''}`}
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
                    <td key={col.key} className={`px-3 py-1.5 text-sm text-[var(--color-text-secondary)]${col.tdClassName ? ` ${col.tdClassName}` : ''}`}>
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
        {renderSummary && sorted.length > 0 && (
          <tfoot>{renderSummary(sorted)}</tfoot>
        )}
      </table>
      </div>
    </>
  )
}
