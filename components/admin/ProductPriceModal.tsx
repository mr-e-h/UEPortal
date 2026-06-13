'use client'

import { X } from 'lucide-react'
import type { Product, SubcontractorProductPrice } from '@/types'
import { fmtNumber } from '@/lib/format'
import StatusPill from '@/components/ui/StatusPill'

const fmt = (n: number) => `${fmtNumber(n, 2)} kr`

export type SubLite = { id: string; company_name: string; county: string; active: boolean }

/**
 * Read-only comparison popup for a single product: which subcontractors have
 * registered a cost price, sorted cheapest-first, with the margin against the
 * customer price. Admin-only surface, so margin/customer price are safe here
 * (UEs never see this component).
 */
export default function ProductPriceModal({
  product,
  prices,
  subcontractors,
  onClose,
}: {
  product: Product
  prices: SubcontractorProductPrice[]
  subcontractors: SubLite[]
  onClose: () => void
}) {
  const subById = new Map(subcontractors.map((s) => [s.id, s]))

  // Prices for this product, enriched with the UE name, sorted ascending by
  // cost so the cheapest supplier is on top.
  const rows = prices
    .filter((p) => p.product_id === product.id)
    .map((p) => ({
      price: p,
      sub: subById.get(p.subcontractor_id) ?? null,
    }))
    .sort((a, b) => a.price.cost_price - b.price.cost_price)

  const pricedSubIds = new Set(rows.map((r) => r.price.subcontractor_id))
  // Active UEs that have NOT registered a price for this product.
  const missing = subcontractors
    .filter((s) => s.active !== false && !pricedSubIds.has(s.id))
    .sort((a, b) => a.company_name.localeCompare(b.company_name, 'nb'))

  const cheapest = rows.length > 0 ? rows[0].price.cost_price : null
  const customerPrice = product.customer_price

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border flex-none">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[var(--color-text-primary)] truncate">
              {product.description ? `${product.description} – ` : ''}{product.name}
            </h2>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
              Utsalgspris {fmt(customerPrice)} · enhet {product.unit}
              {product.county ? ` · ${product.county}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 -mr-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] flex-none"
            aria-label="Lukk"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4 space-y-5">
          <section>
            <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
              UE-priser ({rows.length})
            </h3>
            {rows.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">Ingen underentreprenører har registrert pris på dette produktet ennå.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                    <th className="py-2 pr-3">Underentreprenør</th>
                    <th className="py-2 px-3 text-right">Kostpris</th>
                    <th className="py-2 px-3 text-right">Margin</th>
                    <th className="py-2 pl-3 text-right">Diff. fra billigste</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ price, sub }, i) => {
                    const margin = customerPrice - price.cost_price
                    const marginPct = customerPrice > 0 ? (margin / customerPrice) * 100 : 0
                    const diff = cheapest === null ? 0 : price.cost_price - cheapest
                    return (
                      <tr key={price.id} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 pr-3">
                          <span className="font-medium text-[var(--color-text-primary)]">{sub?.company_name ?? 'Ukjent UE'}</span>
                          {i === 0 && (
                            <span className="ml-2 align-middle">
                              <StatusPill tone="green">Billigst</StatusPill>
                            </span>
                          )}
                          {sub && sub.active === false && (
                            <span className="ml-2 align-middle">
                              <StatusPill tone="gray">Inaktiv</StatusPill>
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-medium text-[var(--color-text-primary)] whitespace-nowrap">{fmt(price.cost_price)}</td>
                        <td className={`py-2 px-3 text-right whitespace-nowrap ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmt(margin)}
                          <span className="text-xs text-[var(--color-text-muted)] ml-1">({marginPct.toFixed(0)}%)</span>
                        </td>
                        <td className="py-2 pl-3 text-right whitespace-nowrap text-[var(--color-text-muted)]">
                          {diff === 0 ? '–' : `+${fmt(diff)}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>

          {missing.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
                Aktive UE uten pris ({missing.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {missing.map((s) => (
                  <span key={s.id} className="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-xs border border-amber-200">
                    {s.company_name}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
