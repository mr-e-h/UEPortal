'use client'

import { useState } from 'react'
import NumberInput from '@/components/NumberInput'
import { fmtNOK as fmt } from '@/lib/format'
import { internalCostMonths, expandedInternalCost, fallbackEndMonthIndex } from '@/lib/internal-costs'
import type { ProjectInternalCostEntry } from '@/types'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des']

interface Props {
  projectId: string
  internalCosts: ProjectInternalCostEntry[]
  totalInternalCost: number
  /** Prosjektets sluttdato — sluttmåned for åpne løpende poster. */
  projectEnd: string | null
  /** Called after a successful POST so the parent can re-fetch. */
  onAdded: () => void
  /** Open the parent's confirm dialog with the row id queued for deletion. */
  onRequestDelete: (entryId: string) => void
}

const periodLabel = (c: ProjectInternalCostEntry): string => {
  const start = `${MONTH_LABELS[c.month - 1]} ${c.year}`
  if (c.recurrence !== 'monthly') return start
  const end = c.end_year != null && c.end_month != null ? `${MONTH_LABELS[c.end_month - 1]} ${c.end_year}` : 'løpende'
  return `${start} → ${end}`
}

/**
 * Form + table for the "Interne kostnader" tab. Hver post er enten et
 * engangskjøp (one_time, i én måned) eller en løpende månedlig kostnad
 * (monthly, f.eks. leie riggplass) med valgfri sluttmåned. Summering utvider
 * månedlige poster over periodene (lib/internal-costs.ts).
 */
export default function InternalCostsSection({
  projectId,
  internalCosts,
  totalInternalCost,
  projectEnd,
  onAdded,
  onRequestDelete,
}: Props) {
  const now = new Date()
  const fallbackEndMi = fallbackEndMonthIndex(projectEnd, now)
  const [draft, setDraft] = useState({
    recurrence: 'one_time' as 'one_time' | 'monthly',
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    amount: '',
    comment: '',
    hasEnd: false,
    end_year: now.getFullYear(),
    end_month: 12,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isMonthly = draft.recurrence === 'monthly'

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    const res = await fetch('/api/project-internal-costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        year: draft.year,
        month: draft.month,
        amount: Number(draft.amount),
        comment: draft.comment,
        recurrence: draft.recurrence,
        end_year: isMonthly && draft.hasEnd ? draft.end_year : null,
        end_month: isMonthly && draft.hasEnd ? draft.end_month : null,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }))
      setError(d.error ?? 'Lagring feilet')
      return
    }
    setDraft((p) => ({ ...p, amount: '', comment: '' }))
    onAdded()
  }

  const sorted = [...internalCosts].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month
  )

  const labelCls = 'block text-xs font-medium text-[var(--color-text-secondary)] mb-1'
  const inputCls = 'px-2 py-1.5 text-sm text-[var(--color-text-primary)] border border-border rounded focus:outline-none focus:ring-blue-500'

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Interne kostnader</h2>

      <form onSubmit={add} className="bg-muted border border-border rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className={labelCls}>Type</label>
          <select
            value={draft.recurrence}
            onChange={(e) => setDraft((p) => ({ ...p, recurrence: e.target.value as 'one_time' | 'monthly' }))}
            className={inputCls}
          >
            <option value="one_time">Engangskjøp</option>
            <option value="monthly">Løpende månedlig</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>{isMonthly ? 'Fra måned' : 'Måned'}</label>
          <div className="flex gap-2">
            <select value={draft.month} onChange={(e) => setDraft((p) => ({ ...p, month: Number(e.target.value) }))} className={inputCls}>
              {MONTH_LABELS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <input type="number" min="2020" max="2040" value={draft.year} onChange={(e) => setDraft((p) => ({ ...p, year: Number(e.target.value) }))} className={`${inputCls} w-20`} />
          </div>
        </div>
        {isMonthly && (
          <div>
            <label className={labelCls}>Til måned</label>
            <div className="flex gap-2 items-center">
              <label className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                <input type="checkbox" checked={draft.hasEnd} onChange={(e) => setDraft((p) => ({ ...p, hasEnd: e.target.checked }))} />
                sett
              </label>
              {draft.hasEnd ? (
                <>
                  <select value={draft.end_month} onChange={(e) => setDraft((p) => ({ ...p, end_month: Number(e.target.value) }))} className={inputCls}>
                    {MONTH_LABELS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                  <input type="number" min="2020" max="2040" value={draft.end_year} onChange={(e) => setDraft((p) => ({ ...p, end_year: Number(e.target.value) }))} className={`${inputCls} w-20`} />
                </>
              ) : (
                <span className="text-xs text-[var(--color-text-muted)]">løper ut prosjektet</span>
              )}
            </div>
          </div>
        )}
        <div>
          <label className={labelCls}>Beløp{isMonthly ? ' / måned' : ''} (NOK)</label>
          <NumberInput required value={draft.amount} onChange={(raw) => setDraft((p) => ({ ...p, amount: raw }))} className={`${inputCls} w-36`} />
        </div>
        <div>
          <label className={labelCls}>Kommentar</label>
          <input type="text" value={draft.comment} onChange={(e) => setDraft((p) => ({ ...p, comment: e.target.value }))} className={`${inputCls} w-48`} placeholder={isMonthly ? 'F.eks. leie riggplass' : 'Valgfri kommentar'} />
        </div>
        <button type="submit" disabled={saving} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Lagrer...' : '+ Legg til'}
        </button>
        {error && <p className="w-full text-xs text-red-600">{error}</p>}
      </form>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted border-b border-border">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">Type</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">Periode</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)]">Beløp</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)]">Sum</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)]">Kommentar</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
                  Ingen interne kostnader registrert
                </td>
              </tr>
            ) : (
              sorted.map((c) => {
                const monthly = c.recurrence === 'monthly'
                const months = internalCostMonths(c, fallbackEndMi)
                return (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted">
                    <td className="px-4 py-2.5">
                      <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${monthly ? 'bg-indigo-100 text-indigo-700' : 'bg-muted text-[var(--color-text-secondary)]'}`}>
                        {monthly ? 'Løpende' : 'Engang'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">
                      {periodLabel(c)}{monthly && <span className="text-[var(--color-text-muted)] font-normal ml-1.5 text-xs">({months} mnd)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--color-text-primary)]">{fmt(c.amount)}{monthly && <span className="text-[var(--color-text-muted)] text-xs">/mnd</span>}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--color-text-primary)]">{fmt(expandedInternalCost(c, fallbackEndMi))}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)] text-xs">{c.comment}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => onRequestDelete(c.id)} className="text-xs text-red-500 hover:text-red-700">Slett</button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="bg-muted border-t border-border">
                <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-[var(--color-text-secondary)] uppercase">Totalt (utvidet)</td>
                <td className="px-4 py-2.5 text-right font-bold text-[var(--color-text-primary)]">{fmt(totalInternalCost)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  )
}
