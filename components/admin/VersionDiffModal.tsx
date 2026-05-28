'use client'

import { X } from 'lucide-react'
import type { ActivityEntry } from '@/types'
import { fmtNOK as fmt } from '@/lib/format'
import { activityActionLabel } from '@/lib/activity-actions'

interface Props {
  entry: ActivityEntry | null
  productNameLookup?: (id: string) => string
  onClose: () => void
}

const NUMERIC_KEYS = new Set([
  'total_cost',
  'total_customer_value',
  'profit',
  'cost_price_snapshot',
  'customer_price_snapshot',
  'requested_quantity',
])

const MONEY_KEYS = new Set([
  'total_cost',
  'total_customer_value',
  'profit',
  'cost_price_snapshot',
  'customer_price_snapshot',
])

const LABELS: Record<string, string> = {
  requested_quantity: 'Mengde',
  unit: 'Enhet',
  reason: 'Begrunnelse',
  product_id: 'Produkt',
  total_cost: 'Total kostnad',
  total_customer_value: 'Salgsverdi',
  profit: 'Fortjeneste',
  cost_price_snapshot: 'UE-kostpris',
  customer_price_snapshot: 'Kundepris',
}

function formatValue(key: string, value: unknown, productNameLookup?: (id: string) => string): string {
  if (value === null || value === undefined || value === '') return '–'
  if (key === 'product_id' && typeof value === 'string') {
    return productNameLookup ? productNameLookup(value) : value
  }
  if (MONEY_KEYS.has(key) && typeof value === 'number') return fmt(value)
  if (NUMERIC_KEYS.has(key) && typeof value === 'number') return String(value)
  return String(value)
}

/**
 * Modal that pops up when a Versjonslogg row is clicked. Shows the structured
 * before/after snapshot stored on activity_log.metadata as a side-by-side
 * table. Same UI works for admin AND UE — the activity GET endpoint strips
 * customer-pricing keys from metadata before sending to UEs, so this
 * component naturally omits those rows there too.
 */
export default function VersionDiffModal({ entry, productNameLookup, onClose }: Props) {
  if (!entry) return null

  const before = entry.metadata?.before ?? {}
  const after = entry.metadata?.after ?? {}
  // Union of all keys present in either snapshot, in a stable order.
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((k) => k in LABELS) // hide unmapped keys (would just clutter)
    .sort((a, b) => Object.keys(LABELS).indexOf(a) - Object.keys(LABELS).indexOf(b))

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Versjon</p>
            <h2 className="text-base font-semibold text-gray-900">
              {activityActionLabel(entry.action)}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {entry.actor} · {new Date(entry.created_at).toLocaleString('nb-NO', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Lukk"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {entry.comment && (
            <div className="text-sm bg-gray-50 border border-gray-200 rounded p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Sammendrag</p>
              <p className="text-gray-700">{entry.comment}</p>
            </div>
          )}

          {allKeys.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Ingen detaljert diff lagret for denne hendelsen</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Felt</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Gammel verdi</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Ny verdi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allKeys.map((key) => {
                    const oldVal = before[key]
                    const newVal = after[key]
                    const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal)
                    return (
                      <tr key={key} className={changed ? 'bg-yellow-50/60' : ''}>
                        <td className="px-3 py-2 text-xs font-medium text-gray-600">{LABELS[key] ?? key}</td>
                        <td className="px-3 py-2 text-xs text-gray-700 tabular-nums">
                          {formatValue(key, oldVal, productNameLookup)}
                        </td>
                        <td className={`px-3 py-2 text-xs tabular-nums ${changed ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                          {formatValue(key, newVal, productNameLookup)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
          >
            Lukk
          </button>
        </footer>
      </div>
    </div>
  )
}
