'use client'

import { useState } from 'react'
import { Plus, ChevronRight } from 'lucide-react'
import Card from '@/components/ui/Card'
import NumberInput from '@/components/NumberInput'
import { fmtNOK as fmt } from '@/lib/format'
import type { ProjectInternalCostEntry } from '@/types'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des']

interface Props {
  projectId: string
  internalCosts: ProjectInternalCostEntry[]
  /** Ferdig utvidet total (engang + løpende), regnet i forelderen. */
  totalInternalCost: number
  onAdded: () => void
  /** Bytt til den fulle «Interne kostnader»-fanen. */
  onOpenFull: () => void
}

/**
 * Kompakt internkostnad-kort på Oversikt: løpende/mnd + engangskjøp + total,
 * med hurtig-innlegging (engang eller løpende månedlig) og lenke til full fane.
 */
export default function InternalCostsSummaryCard({ projectId, internalCosts, totalInternalCost, onAdded, onOpenFull }: Props) {
  const now = new Date()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    recurrence: 'one_time' as 'one_time' | 'monthly',
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    amount: '',
    comment: '',
  })

  const monthly = internalCosts.filter((c) => c.recurrence === 'monthly')
  const oneTime = internalCosts.filter((c) => c.recurrence !== 'monthly')
  const sumMonthlyPerMonth = monthly.reduce((s, c) => s + (c.amount ?? 0), 0)
  const sumOneTime = oneTime.reduce((s, c) => s + (c.amount ?? 0), 0)
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
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }))
      setError(d.error ?? 'Lagring feilet'); return
    }
    setDraft((p) => ({ ...p, amount: '', comment: '' }))
    setOpen(false)
    onAdded()
  }

  const inputCls = 'px-2 py-1.5 text-sm text-[var(--color-text-primary)] border border-border rounded focus:outline-none focus:border-primary bg-card'

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Interne kostnader</h2>
        <button type="button" onClick={onOpenFull} className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
          Se alle <ChevronRight size={13} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Løpende</p>
          <p className="text-base font-bold text-[var(--color-text-primary)] tabular-nums">{fmt(sumMonthlyPerMonth)}<span className="text-xs font-normal text-[var(--color-text-muted)]">/mnd</span></p>
          <p className="text-[10px] text-[var(--color-text-muted)]">{monthly.length} {monthly.length === 1 ? 'post' : 'poster'}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Engangskjøp</p>
          <p className="text-base font-bold text-[var(--color-text-primary)] tabular-nums">{fmt(sumOneTime)}</p>
          <p className="text-[10px] text-[var(--color-text-muted)]">{oneTime.length} {oneTime.length === 1 ? 'post' : 'poster'}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Total</p>
          <p className="text-base font-bold text-[var(--color-text-primary)] tabular-nums">{fmt(totalInternalCost)}</p>
          <p className="text-[10px] text-[var(--color-text-muted)]">utvidet over periodene</p>
        </div>
      </div>

      {open ? (
        <form onSubmit={add} className="mt-4 pt-4 border-t border-border flex flex-wrap gap-3 items-end">
          <select value={draft.recurrence} onChange={(e) => setDraft((p) => ({ ...p, recurrence: e.target.value as 'one_time' | 'monthly' }))} className={inputCls} aria-label="Type">
            <option value="one_time">Engangskjøp</option>
            <option value="monthly">Løpende månedlig</option>
          </select>
          <div className="flex gap-1.5">
            <select value={draft.month} onChange={(e) => setDraft((p) => ({ ...p, month: Number(e.target.value) }))} className={inputCls} aria-label={isMonthly ? 'Fra måned' : 'Måned'}>
              {MONTH_LABELS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <input type="number" min="2020" max="2040" value={draft.year} onChange={(e) => setDraft((p) => ({ ...p, year: Number(e.target.value) }))} className={`${inputCls} w-20`} aria-label="År" />
          </div>
          <NumberInput required value={draft.amount} onChange={(raw) => setDraft((p) => ({ ...p, amount: raw }))} className={`${inputCls} w-32`} />
          <input type="text" value={draft.comment} onChange={(e) => setDraft((p) => ({ ...p, comment: e.target.value }))} placeholder={isMonthly ? 'F.eks. leie riggplass' : 'Kommentar'} className={`${inputCls} w-44`} />
          <button type="submit" disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">{saving ? 'Lagrer…' : 'Legg til'}</button>
          <button type="button" onClick={() => setOpen(false)} className="px-2 py-1.5 text-sm text-[var(--color-text-secondary)] hover:underline">Avbryt</button>
          {isMonthly && <span className="w-full text-[11px] text-[var(--color-text-muted)]">Løper fra valgt måned og ut prosjektet. Sett egen sluttmåned i fanen «Se alle».</span>}
          {error && <p className="w-full text-xs text-red-600">{error}</p>}
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <Plus size={14} /> Legg til intern kostnad
        </button>
      )}
    </Card>
  )
}
