'use client'

import { useEffect, useState, useCallback } from 'react'
import { Trash2, Plus, X } from 'lucide-react'
import type { ProjectInvoice } from '@/types'
import NumberInput from '@/components/NumberInput'
import ConfirmDialog from '@/components/ConfirmDialog'
import { fmtNOK as fmt } from '@/lib/format'

export default function InvoicesSection({ projectId }: { projectId: string }) {
  const [invoices, setInvoices] = useState<ProjectInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState({ amount: '', invoice_date: '', comment: '' })

  const load = useCallback(async () => {
    const data = await fetch(`/api/invoices?project_id=${projectId}`).then((r) => r.json())
    setInvoices(data)
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, amount: Number(form.amount), invoice_date: form.invoice_date, comment: form.comment }),
    })
    setForm({ amount: '', invoice_date: '', comment: '' })
    setShowForm(false)
    setSaving(false)
    load()
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    setConfirmDeleteId(null)
    await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
    setInvoices((p) => p.filter((i) => i.id !== id))
    setDeleting(null)
  }

  const total = invoices.reduce((s, i) => s + i.amount, 0)

  return (
    <section className="bg-white rounded-lg shadow p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Fakturaer</h2>
          {!loading && invoices.length > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">Totalt fakturert: <span className="font-semibold text-gray-800">{fmt(total)}</span></p>
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
        <form onSubmit={handleAdd} className="bg-gray-50 border border-gray-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Fakturert beløp (NOK)</label>
            <NumberInput
              required
              value={form.amount}
              onChange={(raw) => setForm((p) => ({ ...p, amount: raw }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Fakturadato</label>
            <input
              required
              type="date"
              value={form.invoice_date}
              onChange={(e) => setForm((p) => ({ ...p, invoice_date: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Kommentar</label>
            <input
              type="text"
              value={form.comment}
              onChange={(e) => setForm((p) => ({ ...p, comment: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-gray-900"
            />
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <button type="submit" disabled={saving} className="px-4 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Lagrer...' : 'Lagre faktura'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Laster...</p>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-gray-400">Ingen fakturaer registrert ennå.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Dato', 'Beløp', 'Kommentar', 'Registrert av', ''].map((h) => (
                  <th key={h} className={`py-2 px-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide ${h === 'Beløp' ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="py-2 px-3 text-gray-700">{inv.invoice_date}</td>
                  <td className="py-2 px-3 text-right font-medium text-gray-900">{fmt(inv.amount)}</td>
                  <td className="py-2 px-3 text-gray-500">{inv.comment || '–'}</td>
                  <td className="py-2 px-3 text-gray-400 text-xs">{inv.created_by}</td>
                  <td className="py-2 px-3 text-right">
                    <button
                      onClick={() => setConfirmDeleteId(inv.id)}
                      disabled={deleting === inv.id}
                      className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50">
                <td colSpan={2} className="py-2 px-3 text-right text-sm font-bold text-gray-900">Totalt: {fmt(total)}</td>
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {confirmDeleteId && (
        <ConfirmDialog
          title="Slett faktura?"
          message="Fakturaen slettes permanent. Dette kan ikke angres."
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
