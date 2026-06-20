'use client'

import { useEffect, useState, useCallback } from 'react'
import { Trash2, Plus, X } from 'lucide-react'
import type { ProjectInvoice } from '@/types'
import NumberInput from '@/components/NumberInput'
import ConfirmDialog from '@/components/ConfirmDialog'
import { fmtNOK as fmt } from '@/lib/format'
import { useMe } from '@/lib/useMe'
import SortableTable, { type Column } from '@/components/SortableTable'

function INVOICE_COLUMNS(
  canUndo: boolean,
  deleting: string | null,
  onDelete: (id: string) => void,
): Column<ProjectInvoice>[] {
  return [
    {
      key: 'invoice_date',
      label: 'Dato',
      sortable: true,
      getValue: (inv) => inv.invoice_date,
      render: (inv) => (
        <span className="text-[var(--color-text-secondary)]">{inv.invoice_date}</span>
      ),
    },
    {
      key: 'amount',
      label: 'Beløp',
      sortable: true,
      getValue: (inv) => inv.amount,
      tdClassName: 'text-right',
      render: (inv) => (
        <span className="font-medium text-[var(--color-text-primary)]">{fmt(inv.amount)}</span>
      ),
    },
    {
      key: 'comment',
      label: 'Kommentar',
      sortable: true,
      getValue: (inv) => inv.comment ?? '',
      render: (inv) => (
        <span className="text-[var(--color-text-muted)]">{inv.comment || '–'}</span>
      ),
    },
    {
      key: 'created_by',
      label: 'Registrert av',
      sortable: true,
      getValue: (inv) => inv.created_by ?? '',
      render: (inv) => (
        <span className="text-[var(--color-text-muted)] text-xs">{inv.created_by}</span>
      ),
    },
    {
      key: '_actions',
      label: '',
      tdClassName: 'text-right',
      render: (inv) =>
        canUndo ? (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(inv.id) }}
            disabled={deleting === inv.id}
            title="Angre fakturering"
            aria-label="Angre fakturering"
            className="text-[var(--color-text-muted)] hover:text-red-500 transition-colors disabled:opacity-40"
          >
            <Trash2 size={14} />
          </button>
        ) : null,
    },
  ]
}

export default function InvoicesSection({ projectId }: { projectId: string }) {
  const { me } = useMe()
  // Angre fakturering = kun administrasjonsnivå (main/company). PL kan registrere
  // fakturering, men ikke reversere den — så undo-knappen vises ikke for dem.
  const canUndo = me?.role === 'main' || me?.role === 'company'

  const [invoices, setInvoices] = useState<ProjectInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ amount: '', invoice_date: '', comment: '' })

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices?project_id=${projectId}`)
      const data = await res.json().catch(() => null)
      // GET returns an array on success but { error } with status 500 on failure.
      // Never put a non-array into state — invoices.reduce(...) in render would
      // throw and, with no ErrorBoundary in the tree, blank the whole route.
      if (!res.ok || !Array.isArray(data)) {
        setError('Kunne ikke laste fakturaer')
        setInvoices([])
      } else {
        setInvoices(data)
      }
    } catch {
      setError('Kunne ikke laste fakturaer')
      setInvoices([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, amount: Number(form.amount), invoice_date: form.invoice_date, comment: form.comment }),
      })
      // On 403/500/400 the form must NOT clear/close silently — surface the error
      // so the user knows the invoice was never created.
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string }))
        setError(d.error ?? 'Kunne ikke lagre fakturaen')
        return
      }
      setForm({ amount: '', invoice_date: '', comment: '' })
      setShowForm(false)
      await load()
    } catch {
      setError('Kunne ikke lagre fakturaen')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    setConfirmDeleteId(null)
    setError(null)
    const res = await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setInvoices((p) => p.filter((i) => i.id !== id))
    } else {
      const d = await res.json().catch(() => ({} as { error?: string }))
      setError(d.error ?? 'Kunne ikke angre faktureringen')
    }
    setDeleting(null)
  }

  const total = invoices.reduce((s, i) => s + i.amount, 0)

  return (
    <section className="bg-white rounded-lg shadow p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Fakturaer</h2>
          {!loading && invoices.length > 0 && (
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">Totalt fakturert: <span className="font-semibold text-[var(--color-text-primary)]">{fmt(total)}</span></p>
          )}
        </div>
        <button
          onClick={() => setShowForm((p) => !p)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors"
        >
          {showForm ? <X size={13} /> : <Plus size={13} />}
          {showForm ? 'Avbryt' : 'Legg til faktura'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-muted border border-border rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Fakturert beløp (NOK)</label>
            <NumberInput
              required
              value={form.amount}
              onChange={(raw) => setForm((p) => ({ ...p, amount: raw }))}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-[var(--color-text-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Fakturadato</label>
            <input
              required
              type="date"
              value={form.invoice_date}
              onChange={(e) => setForm((p) => ({ ...p, invoice_date: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-[var(--color-text-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Kommentar</label>
            <input
              type="text"
              value={form.comment}
              onChange={(e) => setForm((p) => ({ ...p, comment: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-[var(--color-text-primary)]"
            />
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <button type="submit" disabled={saving} className="px-4 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Lagrer...' : 'Lagre faktura'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Laster...</p>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Ingen fakturaer registrert ennå.</p>
      ) : (
        <>
          <SortableTable<ProjectInvoice>
            searchable
            searchPlaceholder="Søk i fakturaer …"
            getSearchText={(inv) => `${inv.comment ?? ''} ${inv.created_by ?? ''}`}
            columns={INVOICE_COLUMNS(canUndo, deleting, setConfirmDeleteId)}
            data={invoices}
            emptyText="Ingen fakturaer matcher søket."
          />
          <div className="flex justify-end border-t border-border pt-2">
            <span className="text-sm font-bold text-[var(--color-text-primary)]">Totalt: {fmt(total)}</span>
          </div>
        </>
      )}
      {confirmDeleteId && (
        <ConfirmDialog
          title="Angre fakturering?"
          message="Den registrerte faktureringen fjernes, og «Fakturert»-summen reduseres tilsvarende. Dette kan ikke gjenopprettes."
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
