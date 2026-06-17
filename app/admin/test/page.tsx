'use client'

import { useEffect, useMemo, useState } from 'react'
import { fmtNOK as fmt } from '@/lib/format'
import type { ChangeOrder } from '@/types'

/**
 * Test-område: totaloversikt over ALLE endringsmeldinger, summert per år.
 * Grupperes på innsendingsår (faller tilbake til opprettet). Antall telles for
 * alle statuser; beløp (kundeverdi / UE-kost / netto) summeres for GODKJENTE
 * EM-er, siden det er de som faktisk er bindende. Henter alt via
 * /api/change-orders (rolle-scopet server-side).
 */

interface YearRow {
  year: number
  total: number
  approved: number
  pending: number
  rejected: number
  custValue: number
  cost: number
  net: number
}

const emptyTotals = { total: 0, approved: 0, pending: 0, rejected: 0, custValue: 0, cost: 0, net: 0 }

export default function TestPage() {
  const [orders, setOrders] = useState<ChangeOrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/change-orders')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((d) => setOrders(Array.isArray(d) ? d : []))
      .catch(() => setError('Kunne ikke hente endringsmeldinger.'))
  }, [])

  const { rows, totals } = useMemo(() => {
    const map = new Map<number, YearRow>()
    for (const co of orders ?? []) {
      const ds = co.submitted_at ?? co.created_at
      if (!ds) continue
      const year = new Date(ds).getFullYear()
      if (!Number.isFinite(year)) continue
      let r = map.get(year)
      if (!r) { r = { year, total: 0, approved: 0, pending: 0, rejected: 0, custValue: 0, cost: 0, net: 0 }; map.set(year, r) }
      r.total++
      if (co.status === 'approved') {
        r.approved++
        r.custValue += co.total_customer_value ?? 0
        r.cost += co.total_cost ?? 0
      } else if (co.status === 'rejected') {
        r.rejected++
      } else {
        // pending + revision_requested (alt annet enn godkjent/avvist) = under behandling
        r.pending++
      }
    }
    const rows = Array.from(map.values())
    for (const r of rows) r.net = r.custValue - r.cost
    rows.sort((a, b) => b.year - a.year)
    const totals = rows.reduce((t, r) => ({
      total: t.total + r.total, approved: t.approved + r.approved, pending: t.pending + r.pending,
      rejected: t.rejected + r.rejected, custValue: t.custValue + r.custValue, cost: t.cost + r.cost, net: t.net + r.net,
    }), { ...emptyTotals })
    return { rows, totals }
  }, [orders])

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Endringsmeldinger — totaloversikt</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">Alle endringsmeldinger summert per år. Beløp gjelder godkjente EM-er.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {orders === null && !error && (
        <p className="text-sm text-[var(--color-text-muted)]">Laster…</p>
      )}

      {orders !== null && rows.length === 0 && !error && (
        <p className="text-sm text-[var(--color-text-muted)]">Ingen endringsmeldinger registrert ennå.</p>
      )}

      {rows.length > 0 && (
        <>
          {/* KPI-strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi label="Endringsmeldinger" value={String(totals.total)} sub={`${totals.approved} godkjent · ${totals.pending} venter`} />
            <Kpi label="Kundeverdi (godkjent)" value={fmt(totals.custValue)} />
            <Kpi label="UE-kost (godkjent)" value={fmt(totals.cost)} />
            <Kpi label="Netto (godkjent)" value={fmt(totals.net)} tone={totals.net >= 0 ? 'green' : 'red'} />
          </div>

          {/* Tabell per år */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="px-4 py-2.5 text-left font-medium">År</th>
                    <th className="px-4 py-2.5 text-right font-medium">Antall</th>
                    <th className="px-4 py-2.5 text-right font-medium">Godkjent</th>
                    <th className="px-4 py-2.5 text-right font-medium">Venter</th>
                    <th className="px-4 py-2.5 text-right font-medium">Avvist</th>
                    <th className="px-4 py-2.5 text-right font-medium">Kundeverdi</th>
                    <th className="px-4 py-2.5 text-right font-medium">UE-kost</th>
                    <th className="px-4 py-2.5 text-right font-medium">Netto</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.year} className="border-b border-border last:border-0 hover:bg-muted/50">
                      <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">{r.year}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-primary)]">{r.total}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{r.approved}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{r.pending || '–'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">{r.rejected || '–'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-secondary)]">{fmt(r.custValue)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-secondary)]">{fmt(r.cost)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${r.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(r.net)}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted border-t border-border font-semibold">
                    <td className="px-4 py-2.5 text-[var(--color-text-primary)] uppercase text-xs tracking-wide">Totalt</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-primary)]">{totals.total}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{totals.approved}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{totals.pending || '–'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">{totals.rejected || '–'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-primary)]">{fmt(totals.custValue)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-primary)]">{fmt(totals.cost)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${totals.net >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(totals.net)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  )
}

function Kpi({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'green' | 'red' }) {
  const valueClass = tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-600' : 'text-[var(--color-text-primary)]'
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 leading-tight ${valueClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}
