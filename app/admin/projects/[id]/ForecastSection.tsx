'use client'

import Link from 'next/link'
import { fmtNOK as fmt } from '@/lib/format'

interface Props {
  projectId: string
  totalSales: number
  forecastRevenue: number
  forecastUECost: number
  forecastInternalCost: number
  forecastOtherCost: number
  forecastProfit: number
  /** Hero-ens budsjett-prognose (samme kilde/formel) — vises som referanse her
   *  så de to «forventet fortjeneste»-tallene ikke forveksles. */
  budgetProfit: number
  hasForecast: boolean
}

/**
 * "Prognose"-tab. Top KPI strip (only shown when there's any forecast
 * data in monthPlans) + a card that links out to the dedicated forecast
 * editor. The editor itself lives at /admin/projects/[id]/forecast.
 */
export default function ForecastSection({
  projectId,
  totalSales,
  forecastRevenue,
  forecastUECost,
  forecastInternalCost,
  forecastOtherCost,
  forecastProfit,
  budgetProfit,
  hasForecast,
}: Props) {
  return (
    <div className="space-y-6">
      {hasForecast && (
        <section>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3">Prognose — månedlig plan</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl shadow-sm p-4">
              <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">Forventet inntekt</p>
              <p className="text-2xl font-bold text-indigo-900 mt-1">{fmt(forecastRevenue)}</p>
              {forecastRevenue > 0 && totalSales > 0 && (
                <p className={`text-xs mt-0.5 font-medium ${forecastRevenue <= totalSales ? 'text-amber-600' : 'text-red-500'}`}>
                  {forecastRevenue < totalSales
                    ? `−${fmt(totalSales - forecastRevenue)} vs. kontrakt`
                    : `+${fmt(forecastRevenue - totalSales)} vs. kontrakt`}
                </p>
              )}
            </div>
            <div className="bg-white border border-border rounded-xl shadow-sm p-4">
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Forventet UE-kost</p>
              <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{fmt(forecastUECost)}</p>
            </div>
            <div className="bg-white border border-border rounded-xl shadow-sm p-4">
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Forventet internkost</p>
              <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{fmt(forecastInternalCost)}</p>
              {forecastOtherCost > 0 && (
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">+ {fmt(forecastOtherCost)} andre kost.</p>
              )}
            </div>
            <div className={`rounded-xl shadow-sm p-4 border ${forecastProfit >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Forventet fortjeneste (månedsplan)</p>
              <p className={`text-2xl font-bold mt-1 ${forecastProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {fmt(forecastProfit)}
              </p>
              {/* Referanse: hero-ens budsjett-prognose (samme kilde) — så de to
                  «forventet fortjeneste»-tallene ikke forveksles. */}
              <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                Budsjett-prognose: <span className="font-medium text-[var(--color-text-secondary)]">{fmt(budgetProfit)}</span>
                {forecastProfit !== budgetProfit && (
                  <span className={forecastProfit > budgetProfit ? 'text-green-600' : 'text-red-500'}>
                    {' '}({forecastProfit > budgetProfit ? '+' : ''}{fmt(forecastProfit - budgetProfit)})
                  </span>
                )}
              </p>
            </div>
          </div>
        </section>
      )}

      <div className="bg-white rounded-xl border border-border shadow-sm p-8 flex flex-col items-center gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center">
          <svg className="w-8 h-8 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941"
            />
          </svg>
        </div>
        <div>
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Prognoseside</h3>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Legg inn månedlige prognose-tall, forventet inntekt og kostnader per periode.
          </p>
        </div>
        <Link
          href={`/admin/projects/${projectId}/forecast`}
          className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Åpne prognose →
        </Link>
      </div>
    </div>
  )
}
