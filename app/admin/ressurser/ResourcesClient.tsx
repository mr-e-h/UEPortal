'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import Card from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import ErrorBox from '@/components/ui/ErrorBox'
import EmptyState from '@/components/ui/EmptyState'
import { useConfirm } from '@/components/ui/useConfirm'
import { fmtNOK, fmtNumber, parseNorwegianNumber } from '@/lib/format'
import { api, apiErrorMessage } from '@/lib/api'
import type { InternalResource, InternalHoursMonthly } from '@/types'
import type { MonthGrid } from '@/lib/resource-allocation'

type Draft = { name: string; hours_per_month: string; hourly_cost: string }

const MONTHS_FULL_NB = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember']

const seed = (resources: InternalResource[]): Record<string, Draft> =>
  Object.fromEntries(
    resources.map((r) => [r.id, { name: r.name, hours_per_month: String(r.hours_per_month), hourly_cost: String(r.hourly_cost) }]),
  )

// Light heatmap by share of the monthly pool — same blue ramp as the rest of
// the app. Returns inline styles (CSS-var opacity modifiers don't work).
function cellStyle(shareOfPool: number): { background: string; color: string } {
  if (shareOfPool >= 0.6) return { background: '#85B7EB', color: '#042C53' }
  if (shareOfPool >= 0.3) return { background: '#B5D4F4', color: '#0C447C' }
  if (shareOfPool > 0) return { background: '#E6F1FB', color: '#185FA5' }
  return { background: 'transparent', color: 'var(--color-text-info)' }
}

export default function ResourcesClient({
  resources,
  grid,
  monthlyActuals,
  currentYear,
  currentMonthNum,
}: {
  resources: InternalResource[]
  grid: MonthGrid
  monthlyActuals: InternalHoursMonthly[]
  currentYear: number
  currentMonthNum: number
}) {
  const router = useRouter()
  const { confirm: confirmAction, confirmDialog } = useConfirm()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'hours' | 'cost'>('hours')

  // Teamets snittkost per time (Σ kost ÷ Σ timer) — brukes for å vise faktisk
  // kost mens man skriver. Lagrede måneder bruker sin egen snapshotede rate.
  const blendedRate = grid.hoursPerMonth > 0 ? grid.costPerMonth / grid.hoursPerMonth : 0

  // ── Avstemming: faktiske interntimer per måned (jan → inneværende mnd) ──
  const actualByMonth = useMemo(
    () => new Map(monthlyActuals.map((a) => [a.month, a])),
    [monthlyActuals],
  )
  const [hourDrafts, setHourDrafts] = useState<Record<number, string>>(() =>
    Object.fromEntries(monthlyActuals.map((a) => [a.month, String(a.total_hours)])),
  )
  useEffect(() => {
    setHourDrafts(Object.fromEntries(monthlyActuals.map((a) => [a.month, String(a.total_hours)])))
  }, [monthlyActuals])

  async function saveMonth(month: number) {
    const raw = hourDrafts[month] ?? ''
    const existing = actualByMonth.get(month)
    // Tom + ingen rad fra før = ingen endring.
    if (raw.trim() === '' && !existing) return
    const total_hours = parseNorwegianNumber(raw)
    if (existing && total_hours === existing.total_hours) return
    setBusy(true); setError(null)
    try {
      await api.internalHoursMonthly.save({ year: currentYear, month, total_hours })
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, 'Avstemming feilet'))
    } finally {
      setBusy(false)
    }
  }

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => seed(resources))
  useEffect(() => { setDrafts(seed(resources)) }, [resources])

  const [newRow, setNewRow] = useState<Draft>({ name: '', hours_per_month: '', hourly_cost: '' })

  function setField(id: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  async function saveRow(r: InternalResource) {
    const d = drafts[r.id]
    if (!d) return
    const name = d.name.trim()
    const hours_per_month = parseNorwegianNumber(d.hours_per_month)
    const hourly_cost = parseNorwegianNumber(d.hourly_cost)
    if (!name) { setError('Navn er påkrevd'); return }
    if (name === r.name && hours_per_month === r.hours_per_month && hourly_cost === r.hourly_cost) return
    setBusy(true); setError(null)
    try {
      await api.internalResources.update({ id: r.id, name, hours_per_month, hourly_cost })
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, 'Lagring feilet'))
    } finally {
      setBusy(false)
    }
  }

  async function addResource(e: React.FormEvent) {
    e.preventDefault()
    const name = newRow.name.trim()
    if (!name) { setError('Navn er påkrevd'); return }
    setBusy(true); setError(null)
    try {
      await api.internalResources.create({
        name,
        hours_per_month: parseNorwegianNumber(newRow.hours_per_month),
        hourly_cost: parseNorwegianNumber(newRow.hourly_cost),
      })
      setNewRow({ name: '', hours_per_month: '', hourly_cost: '' })
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, 'Kunne ikke legge til ressurs'))
    } finally {
      setBusy(false)
    }
  }

  async function removeResource(r: InternalResource) {
    if (!(await confirmAction({ title: 'Slett ressurs?', message: `«${r.name}» fjernes fra ressurspoolen.`, confirmLabel: 'Slett' }))) return
    setBusy(true); setError(null)
    try {
      await api.internalResources.remove(r.id)
      router.refresh()
    } catch (err) {
      setError(apiErrorMessage(err, 'Sletting feilet'))
    } finally {
      setBusy(false)
    }
  }

  // Year groups for the grid header (consecutive months sharing a year).
  const yearGroups = useMemo(() => {
    const groups: { year: number; span: number }[] = []
    for (const m of grid.months) {
      const last = groups[groups.length - 1]
      if (last && last.year === m.year) last.span++
      else groups.push({ year: m.year, span: 1 })
    }
    return groups
  }, [grid.months])

  const showHours = mode === 'hours'
  const poolPerMonth = showHours ? grid.hoursPerMonth : grid.costPerMonth
  const fmtCell = (v: number) => (showHours ? fmtNumber(Math.round(v), 0) : fmtNOK(v))

  const th = 'px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide'
  const thR = `${th} text-right`
  const td = 'px-4 py-2.5 text-sm'
  const tdR = `${td} text-right tabular-nums`

  return (
    <div className="p-6 space-y-6">
      {confirmDialog}
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Ressursoversikt</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
          Interne ressurser med kapasitet per måned. Poolen fordeles hver måned utover prosjektene
          som er aktive den måneden (fra fremdriftsplanen), vektet på omsetning.
        </p>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {/* ── Ressurspool ───────────────────────────────────────────────── */}
      <Card>
        <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Interne ressurser</h2>
          <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
            <span>Pool/mnd: <strong className="text-[var(--color-text-primary)] tabular-nums">{fmtNumber(grid.hoursPerMonth, 0)} t</strong></span>
            <span>Kostnad/mnd: <strong className="text-[var(--color-text-primary)] tabular-nums">{fmtNOK(grid.costPerMonth)}</strong></span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className={th}>Navn</th>
                <th className={thR}>Timer/mnd</th>
                <th className={thR}>Timeskost</th>
                <th className={thR}>Kostnad/mnd</th>
                <th className={`${th} w-10`}></th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => {
                const d = drafts[r.id] ?? { name: r.name, hours_per_month: String(r.hours_per_month), hourly_cost: String(r.hourly_cost) }
                const monthly = parseNorwegianNumber(d.hours_per_month) * parseNorwegianNumber(d.hourly_cost)
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className={td}>
                      <Input value={d.name} onChange={(e) => setField(r.id, 'name', e.target.value)} onBlur={() => saveRow(r)} disabled={busy} aria-label={`Navn for ${r.name}`} />
                    </td>
                    <td className={tdR}>
                      <Input value={d.hours_per_month} inputMode="decimal" onChange={(e) => setField(r.id, 'hours_per_month', e.target.value)} onBlur={() => saveRow(r)} disabled={busy} className="text-right w-28" aria-label={`Timer per måned for ${r.name}`} />
                    </td>
                    <td className={tdR}>
                      <Input value={d.hourly_cost} inputMode="decimal" onChange={(e) => setField(r.id, 'hourly_cost', e.target.value)} onBlur={() => saveRow(r)} disabled={busy} className="text-right w-32" aria-label={`Timeskost for ${r.name}`} />
                    </td>
                    <td className={`${tdR} text-[var(--color-text-muted)]`}>{fmtNOK(monthly)}</td>
                    <td className={td}>
                      <button type="button" onClick={() => removeResource(r)} disabled={busy} className="p-1 rounded text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50 disabled:opacity-50" title={`Slett ${r.name}`} aria-label={`Slett ${r.name}`}>
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {resources.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">Ingen ressurser ennå — legg til under.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <form onSubmit={addResource} className="px-6 py-4 border-t border-border flex items-end gap-3 flex-wrap">
          <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1 flex-1 min-w-[12rem]">
            Navn
            <Input value={newRow.name} onChange={(e) => setNewRow((p) => ({ ...p, name: e.target.value }))} placeholder="F.eks. Anleggsleder" disabled={busy} />
          </label>
          <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">
            Timer/mnd
            <Input value={newRow.hours_per_month} inputMode="decimal" onChange={(e) => setNewRow((p) => ({ ...p, hours_per_month: e.target.value }))} placeholder="0" disabled={busy} className="w-28 text-right" />
          </label>
          <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">
            Timeskost
            <Input value={newRow.hourly_cost} inputMode="decimal" onChange={(e) => setNewRow((p) => ({ ...p, hourly_cost: e.target.value }))} placeholder="0" disabled={busy} className="w-32 text-right" />
          </label>
          <Button type="submit" disabled={busy} className="flex items-center gap-1.5">
            <Plus size={15} /> Legg til
          </Button>
        </form>
      </Card>

      {/* ── Bemanningsbehov per måned ─────────────────────────────────── */}
      <Card>
        <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Bemanningsbehov per måned</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Fra inneværende måned og framover. Poolen fordeles på aktive prosjekter, vektet på omsetning.</p>
          </div>
          <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
            <button type="button" onClick={() => setMode('hours')} className={`px-3 py-1.5 font-medium ${showHours ? 'bg-primary text-white' : 'bg-card text-[var(--color-text-secondary)] hover:bg-muted'}`}>Timer</button>
            <button type="button" onClick={() => setMode('cost')} className={`px-3 py-1.5 font-medium ${!showHours ? 'bg-primary text-white' : 'bg-card text-[var(--color-text-secondary)] hover:bg-muted'}`}>Kroner</button>
          </div>
        </div>

        {grid.rows.length === 0 ? (
          <EmptyState title="Ingen aktive prosjekter" description="Det finnes ingen aktive prosjekter med datoer å fordele ressurser på." />
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse" style={{ minWidth: '100%' }}>
              <thead>
                <tr>
                  <th rowSpan={2} className="sticky left-0 bg-card px-4 py-2 text-left text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide align-bottom border-b border-border">Prosjekt</th>
                  {yearGroups.map((g, i) => (
                    <th key={`${g.year}-${i}`} colSpan={g.span} className="px-2 py-1 text-center text-[10px] font-medium text-[var(--color-text-muted)] border-b border-border">{g.year}</th>
                  ))}
                  <th rowSpan={2} className="px-4 py-2 text-right text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide align-bottom border-b border-border">Sum</th>
                </tr>
                <tr>
                  {grid.months.map((m, i) => (
                    <th key={m.index} className="px-1.5 py-1 text-center text-[11px] font-normal text-[var(--color-text-muted)] border-b border-border relative min-w-[2.6rem]">
                      {i === 0 && <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-primary leading-none">nå</span>}
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="sticky left-0 bg-card px-4 py-2 min-w-[10rem]">
                      <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">{row.name}</div>
                      <div className="text-[11px] text-[var(--color-text-muted)]">{fmtNOK(row.revenue)}</div>
                    </td>
                    {grid.months.map((m, ci) => {
                      const active = row.startMonth <= m.index && m.index <= row.endMonth
                      const v = showHours ? row.cellsHours[ci] : row.cellsCost[ci]
                      const share = grid.hoursPerMonth > 0 ? row.cellsHours[ci] / grid.hoursPerMonth : 0
                      if (!active) {
                        return <td key={m.index} className="px-1.5 py-2 text-center text-xs text-[var(--color-text-muted)]">–</td>
                      }
                      const s = cellStyle(share)
                      return (
                        <td key={m.index} className="px-0.5 py-0.5 text-center">
                          <div className="rounded px-1 py-1.5 text-xs tabular-nums" style={{ background: s.background, color: s.color }}>{fmtCell(v)}</div>
                        </td>
                      )
                    })}
                    <td className="px-4 py-2 text-right text-sm font-medium tabular-nums text-[var(--color-text-primary)]">
                      {showHours ? `${fmtNumber(Math.round(row.totalHours), 0)} t` : fmtNOK(row.totalCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td className="sticky left-0 bg-card px-4 py-2 text-xs font-semibold text-[var(--color-text-secondary)]">Pool/mnd</td>
                  {grid.months.map((m) => (
                    <td key={m.index} className="px-1.5 py-2 text-center text-xs font-medium tabular-nums text-[var(--color-text-secondary)]">{fmtCell(poolPerMonth)}</td>
                  ))}
                  <td className="px-4 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {grid.hoursPerMonth === 0 && resources.length > 0 && (
          <p className="px-6 py-3 text-xs text-[var(--color-text-muted)] border-t border-border">Ressursene har 0 timer/mnd — legg inn timer for å se fordelingen.</p>
        )}
      </Card>

      {/* ── Avstemming: faktisk internkost per måned ──────────────────────── */}
      <Card>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Avstemming — faktisk internkost {currentYear}</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Legg inn totalt antall interntimer brukt per måned. Kosten fordeles på prosjektene som var aktive
            den måneden i Totaløkonomi, vektet på omsetning. Snittkost nå: <strong className="text-[var(--color-text-primary)] tabular-nums">{fmtNOK(blendedRate)}/t</strong>.
          </p>
        </div>

        {(() => {
          const months = Array.from({ length: currentMonthNum }, (_, i) => i + 1)
          let sumActual = 0
          const estimatePerMonth = grid.costPerMonth
          const rows = months.map((m) => {
            const existing = actualByMonth.get(m)
            const rate = existing ? existing.hourly_cost_snapshot : blendedRate
            const hours = parseNorwegianNumber(hourDrafts[m] ?? '')
            const cost = hours * rate
            sumActual += cost
            return { m, existing, rate, cost }
          })
          return (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={th}>Måned</th>
                      <th className={thR}>Faktiske timer</th>
                      <th className={thR}>Snittkost</th>
                      <th className={thR}>Faktisk kost</th>
                      <th className={thR}>Estimat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ m, rate, cost }) => (
                      <tr key={m} className="border-b border-border last:border-0">
                        <td className={`${td} capitalize text-[var(--color-text-primary)]`}>
                          {MONTHS_FULL_NB[m - 1]}
                          {m === currentMonthNum && <span className="ml-1.5 text-[10px] font-semibold text-primary">nå</span>}
                        </td>
                        <td className={tdR}>
                          <Input
                            value={hourDrafts[m] ?? ''}
                            inputMode="decimal"
                            onChange={(e) => setHourDrafts((p) => ({ ...p, [m]: e.target.value }))}
                            onBlur={() => saveMonth(m)}
                            disabled={busy}
                            placeholder="0"
                            className="text-right w-28"
                            aria-label={`Faktiske timer ${MONTHS_FULL_NB[m - 1]}`}
                          />
                        </td>
                        <td className={`${tdR} text-[var(--color-text-muted)]`}>{fmtNOK(rate)}</td>
                        <td className={`${tdR} font-medium text-[var(--color-text-primary)]`}>{fmtNOK(cost)}</td>
                        <td className={`${tdR} text-[var(--color-text-muted)]`}>{fmtNOK(estimatePerMonth)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/40">
                      <td className={`${td} font-semibold text-[var(--color-text-primary)]`}>Sum hittil i år</td>
                      <td className={tdR}></td>
                      <td className={tdR}></td>
                      <td className={`${tdR} font-semibold text-[var(--color-text-primary)]`}>{fmtNOK(sumActual)}</td>
                      <td className={`${tdR} text-[var(--color-text-muted)]`}>{fmtNOK(estimatePerMonth * months.length)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {resources.length === 0 && (
                <p className="px-6 py-3 text-xs text-[var(--color-text-muted)] border-t border-border">Legg inn ressurser over for å få en snittkost å regne faktisk internkost med.</p>
              )}
            </>
          )
        })()}
      </Card>
    </div>
  )
}
