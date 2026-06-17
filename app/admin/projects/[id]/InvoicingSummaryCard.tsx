'use client'

import { useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import Card from '@/components/ui/Card'
import NumberInput from '@/components/NumberInput'
import { fmtNOK as fmt } from '@/lib/format'
import type { ProjectInvoice } from '@/types'

interface Props {
  projectId: string
  /** Ordreverdi (salgsverdi + godkjente EM) — referanse for «av ordreverdi». */
  orderValue: number
  /** Fakturaer fra useProjectData — samme delte kilde som heroen bruker. */
  invoices: ProjectInvoice[]
  /** Re-hent delt data etter at et fakturert beløp er lagt til (→ fetchAll). */
  onAdded: () => void
  /** Bytt til den fulle «Fakturagrunnlag»-fanen. */
  onOpenInvoices: () => void
}

/**
 * Kompakt fakturerings-halvboks på Oversikt: totalt fakturert mot ordreverdi,
 * hvor mye som gjenstår å fakturere, og en lenke til full fane. Fakturaene
 * kommer fra useProjectData (delt med heroen), så «Fakturert» i heroen og her
 * alltid er samme tall — innlegging trigger onAdded() (fetchAll) som oppdaterer
 * begge.
 */
export default function InvoicingSummaryCard({ projectId, orderValue, invoices, onAdded, onOpenInvoices }: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState(() => ({ amount: '', comment: '', date: new Date().toISOString().slice(0, 10) }))

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, amount: Number(draft.amount), invoice_date: draft.date, comment: draft.comment }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }))
      setError(d.error ?? 'Lagring feilet'); return
    }
    setDraft({ amount: '', comment: '', date: new Date().toISOString().slice(0, 10) })
    setOpen(false)
    onAdded()
  }

  const invoiced = invoices.reduce((s, i) => s + (i.amount ?? 0), 0)
  const remaining = Math.max(0, orderValue - invoiced)
  const pct = orderValue > 0 ? Math.round((invoiced / orderValue) * 100) : 0

  const inputCls = 'px-2 py-1.5 text-sm text-[var(--color-text-primary)] border border-border rounded focus:outline-none focus:border-primary bg-card'

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Fakturering</h2>
        <button type="button" onClick={onOpenInvoices} className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
          Se alle <ChevronRight size={13} />
        </button>
      </div>

      <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Fakturert</p>
      <p className="text-2xl font-bold text-[var(--color-text-primary)] tabular-nums leading-tight mt-0.5">{fmt(invoiced)}</p>
      <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
        {invoices.length} {invoices.length === 1 ? 'faktura' : 'fakturaer'}{orderValue > 0 && <> · {pct}% av ordreverdi</>}
      </p>

      <div className="h-2 rounded-full bg-muted overflow-hidden mt-3">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>

      <div className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[var(--color-text-secondary)]">Ordreverdi</span>
          <span className="tabular-nums text-[var(--color-text-primary)]">{fmt(orderValue)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[var(--color-text-secondary)]">Gjenstår å fakturere</span>
          <span className="tabular-nums font-medium text-[var(--color-text-primary)]">{fmt(remaining)}</span>
        </div>
      </div>

      {/* Hurtig-innlegging av fakturert beløp (dato defaulter til i dag). */}
      {open ? (
        <form onSubmit={add} className="mt-4 pt-4 border-t border-border space-y-2">
          <div className="flex gap-2">
            <NumberInput required value={draft.amount} onChange={(raw) => setDraft((p) => ({ ...p, amount: raw }))} className={`${inputCls} flex-1 w-full`} aria-label="Fakturert beløp" />
            <input type="date" value={draft.date} onChange={(e) => setDraft((p) => ({ ...p, date: e.target.value }))} className={inputCls} aria-label="Fakturadato" />
          </div>
          <input type="text" value={draft.comment} onChange={(e) => setDraft((p) => ({ ...p, comment: e.target.value }))} placeholder="Kommentar" className={`${inputCls} w-full`} />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">{saving ? 'Lagrer…' : 'Legg til'}</button>
            <button type="button" onClick={() => setOpen(false)} className="px-2 py-1.5 text-sm text-[var(--color-text-secondary)] hover:underline">Avbryt</button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <Plus size={14} /> Legg til fakturert beløp
        </button>
      )}
    </Card>
  )
}
