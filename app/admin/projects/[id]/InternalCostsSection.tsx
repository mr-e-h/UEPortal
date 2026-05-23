'use client'

import { useState } from 'react'
import NumberInput from '@/components/NumberInput'
import { fmtNOK as fmt } from '@/lib/format'
import type { ProjectInternalCostEntry } from '@/types'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des']

interface Props {
  projectId: string
  internalCosts: ProjectInternalCostEntry[]
  totalInternalCost: number
  /** Called after a successful POST so the parent can re-fetch. */
  onAdded: () => void
  /** Open the parent's confirm dialog with the row id queued for deletion. */
  onRequestDelete: (entryId: string) => void
}

/**
 * Form + table for the "Interne kostnader" tab. Owns its own draft-form
 * state; the parent only cares about the list and the total (KPIs).
 */
export default function InternalCostsSection({
  projectId,
  internalCosts,
  totalInternalCost,
  onAdded,
  onRequestDelete,
}: Props) {
  const [draft, setDraft] = useState({
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    amount: '',
    comment: '',
  })
  const [saving, setSaving] = useState(false)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/project-internal-costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        year: draft.year,
        month: draft.month,
        amount: Number(draft.amount),
        comment: draft.comment,
      }),
    })
    setDraft({ year: new Date().getFullYear(), month: new Date().getMonth() + 1, amount: '', comment: '' })
    setSaving(false)
    onAdded()
  }

  const sorted = [...internalCosts].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month
  )

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Internkostnader</h2>
      <form onSubmit={add} className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">År</label>
          <input
            type="number"
            required
            min="2020"
            max="2040"
            value={draft.year}
            onChange={(e) => setDraft((p) => ({ ...p, year: Number(e.target.value) }))}
            className="w-24 px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Måned</label>
          <select
            required
            value={draft.month}
            onChange={(e) => setDraft((p) => ({ ...p, month: Number(e.target.value) }))}
            className="text-sm text-gray-900 border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-blue-500"
          >
            {MONTH_LABELS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Beløp (NOK)</label>
          <NumberInput
            required
            value={draft.amount}
            onChange={(raw) => setDraft((p) => ({ ...p, amount: raw }))}
            className="w-36 px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Kommentar</label>
          <input
            type="text"
            value={draft.comment}
            onChange={(e) => setDraft((p) => ({ ...p, comment: e.target.value }))}
            className="w-48 px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-blue-500"
            placeholder="Valgfri kommentar"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Lagrer...' : '+ Legg til'}
        </button>
      </form>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">År / Mnd</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Beløp</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Kommentar</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">
                  Ingen internkostnader registrert
                </td>
              </tr>
            ) : (
              sorted.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{MONTH_LABELS[c.month - 1]} {c.year}</td>
                  <td className="px-4 py-2.5 text-right text-gray-900 font-medium">{fmt(c.amount)}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{c.comment}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => onRequestDelete(c.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Slett
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td className="px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase">Totalt</td>
                <td className="px-4 py-2.5 text-right font-bold text-gray-900">{fmt(totalInternalCost)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  )
}
