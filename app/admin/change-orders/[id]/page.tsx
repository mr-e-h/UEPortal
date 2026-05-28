'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Pencil, X, Save, Printer, History, Plus, Trash2 } from 'lucide-react'
import type { ChangeOrder, ChangeOrderLine, Project, Product, Subcontractor, ActivityEntry } from '@/types'
import { fmtNOK as fmt, fmtProductLabel } from '@/lib/format'
import { activityActionLabel } from '@/lib/activity-actions'
import { useMe } from '@/lib/useMe'
import VersionDiffModal from '@/components/admin/VersionDiffModal'

/**
 * Admin EM-detail layout — two columns:
 *
 *   CENTER (col-span-9) Kundedel — the customer-facing slice (project,
 *                       product, qty, reason, attachment, salgsverdi).
 *                       Rediger + Eksporter PDF buttons sit IN this card
 *                       so they're discoverable next to the content they
 *                       affect. THIS card is what the PDF outputs.
 *
 *   RIGHT (col-span-3)  Stacked:
 *                         • Internt — kost + salgs + fortjeneste + margin
 *                         • Versjonslogg — diff trail of edits + status
 *                           changes (also visible to the UE on their side,
 *                           but the UE never sees customer-prices).
 *                       Both print:hidden.
 *
 * Eksporter PDF first POSTs to /mark-sent which stamps
 * change_orders.sent_to_customer_at = now and writes an audit row. The
 * status stays 'pending' but the dashboard pill flips from yellow
 * 'Ubehandlet' to blue 'Til behandling' so admin can see which pending
 * EMs are out at the customer.
 */

export default function ChangeOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { me } = useMe()
  const adminName = me?.full_name ?? 'Admin'
  const [co, setCo] = useState<ChangeOrder | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [sub, setSub] = useState<Subcontractor | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [exporting, setExporting] = useState(false)

  // EM lines — source of truth for product + qty in multi-line mode.
  const [lines, setLines] = useState<ChangeOrderLine[]>([])
  // Inline edit. Allowed for draft + pending (admin).
  // editLines drives the editable table; each row has product_id and qty.
  type EditLine = { tempId: string; product_id: string; requested_quantity: string }
  const [editing, setEditing] = useState(false)
  const [editLines, setEditLines] = useState<EditLine[]>([])
  const [editReason, setEditReason] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // Versjonslogg diff popup
  const [diffEntry, setDiffEntry] = useState<ActivityEntry | null>(null)
  const [products, setProducts] = useState<Product[]>([])

  const load = useCallback(async () => {
    const [orders, projects, products, subs, activityData, linesData] = await Promise.all([
      fetch(`/api/change-orders?id=${id}`).then((r) => r.json()),
      fetch('/api/projects').then((r) => r.json()),
      fetch('/api/products').then((r) => r.json()),
      fetch('/api/subcontractors').then((r) => r.json()),
      fetch(`/api/activity?entity_id=${id}&entity_type=change_order`).then((r) => r.json()),
      fetch(`/api/change-orders/${id}/lines`).then((r) => r.json()),
    ])
    const found: ChangeOrder = orders[0] ?? null
    setCo(found)
    setProducts(Array.isArray(products) ? (products as Product[]) : [])
    if (found) {
      setProject((projects as Project[]).find((p) => p.id === found.project_id) ?? null)
      setProduct((products as Product[]).find((p) => p.id === found.product_id) ?? null)
      setSub((subs as Subcontractor[]).find((s) => s.id === found.subcontractor_id) ?? null)
      setComment(found.admin_comment ?? '')
    }
    setActivity(Array.isArray(activityData) ? activityData : [])
    setLines(Array.isArray(linesData) ? (linesData as ChangeOrderLine[]) : [])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleStatus(status: 'approved' | 'rejected' | 'pending') {
    setSubmitting(true)
    await fetch(`/api/change-orders/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, admin_comment: comment || undefined, reviewed_by: adminName }),
    })
    await load()
    setSubmitting(false)
  }

  function startEdit() {
    if (!co) return
    const seed: EditLine[] = lines.length > 0
      ? lines.map((l) => ({
          tempId: l.id,
          product_id: l.product_id,
          requested_quantity: String(l.requested_quantity),
        }))
      : [{ tempId: crypto.randomUUID(), product_id: co.product_id, requested_quantity: String(co.requested_quantity) }]
    setEditLines(seed)
    setEditReason(co.reason ?? '')
    setEditError(null)
    setEditing(true)
  }

  function addEditLine() {
    setEditLines((prev) => [
      ...prev,
      { tempId: crypto.randomUUID(), product_id: '', requested_quantity: '' },
    ])
  }

  function removeEditLine(tempId: string) {
    setEditLines((prev) => prev.length <= 1 ? prev : prev.filter((l) => l.tempId !== tempId))
  }

  function updateEditLine(tempId: string, patch: Partial<EditLine>) {
    setEditLines((prev) => prev.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l)))
  }

  async function saveEdit() {
    setEditSaving(true)
    setEditError(null)
    // Validate locally before round-tripping.
    const cleaned: Array<{ product_id: string; requested_quantity: number }> = []
    for (const ln of editLines) {
      if (!ln.product_id) {
        setEditError('Velg produkt på alle linjer')
        setEditSaving(false)
        return
      }
      const qty = Number(ln.requested_quantity)
      if (!Number.isFinite(qty) || qty <= 0) {
        setEditError('Mengde må være et positivt tall på hver linje')
        setEditSaving(false)
        return
      }
      cleaned.push({ product_id: ln.product_id, requested_quantity: qty })
    }
    const res = await fetch(`/api/change-orders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: cleaned, reason: editReason }),
    })
    setEditSaving(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setEditError(data.error ?? 'Lagring feilet')
      return
    }
    setEditing(false)
    await load()
  }

  async function exportPDF() {
    // Mark-as-sent first, THEN print. If the user cancels the print
    // dialog the flag still stays — that's fine, exporting at all is
    // strong enough signal that admin sent it out.
    setExporting(true)
    if (co?.status === 'pending' && !co.sent_to_customer_at) {
      try {
        await fetch(`/api/change-orders/${id}/mark-sent`, { method: 'POST' })
        await load()
      } catch { /* still allow print even if flagging fails */ }
    }
    setExporting(false)
    // setTimeout so the state update (sent_to_customer_at) has a tick to
    // flow into the rendered PDF before print fires.
    setTimeout(() => window.print(), 50)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Laster...</div>
  if (!co) return <div className="min-h-screen flex items-center justify-center text-gray-500">Endringsmelding ikke funnet</div>

  const isReviewed = co.status !== 'pending'
  const sentToCustomer = co.status === 'pending' && !!co.sent_to_customer_at
  const margin = co.total_customer_value > 0
    ? Math.round((co.profit / co.total_customer_value) * 100)
    : 0

  // Status pill — three states for a pending EM (untouched, sent-to-customer,
  // mid-review), plus the existing approved/rejected.
  const statusPill: { label: string; cls: string } = (() => {
    if (co.status === 'approved') return { label: 'Godkjent', cls: 'bg-green-100 text-green-700' }
    if (co.status === 'rejected') return { label: 'Avslått', cls: 'bg-red-100 text-red-700' }
    if (co.status === 'draft') return { label: 'Kladd', cls: 'bg-gray-100 text-gray-500' }
    if (sentToCustomer) return { label: 'Til behandling', cls: 'bg-blue-50 text-blue-700' }
    return { label: 'Ubehandlet', cls: 'bg-amber-50 text-amber-700' }
  })()

  // Versjonslogg events — every non-comment activity entry. Newest first.
  const versionEvents = activity
    .filter((a) => a.action !== 'commented')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style jsx global>{`
        @media print {
          .print\\:hidden { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <header className="bg-white shadow print:hidden">
        <div className="px-4 sm:px-6 py-4 flex items-center gap-3 flex-wrap">
          <Link href="/admin" className="text-gray-400 hover:text-gray-600 text-sm">← Dashboard</Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Endringsmelding</h1>
            <p className="text-sm text-gray-500">{project?.name ?? '–'} · {sub?.company_name ?? '–'}</p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded ${statusPill.cls}`}>{statusPill.label}</span>
            {isReviewed && (
              <button
                onClick={() => handleStatus('pending')}
                disabled={submitting}
                className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                Angre
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* CENTER — Kundedel (printable) */}
        <section className="lg:col-span-9 space-y-6">
          <div className="bg-white rounded-lg shadow p-6 space-y-5">
            <div className="border-b border-gray-100 pb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-gray-400">Endringsmelding</p>
                <h2 className="text-lg font-bold text-gray-900">{project?.name ?? '–'}</h2>
                <p className="text-xs text-gray-500">
                  Prosjektnummer: {project?.project_number ?? '–'}
                  {co.submitted_at && ` · Innsendt ${co.submitted_at.split('T')[0]}`}
                </p>
              </div>
              {/* Action buttons live INSIDE the card so they're near the content
                  they affect. Hidden in print. */}
              <div className="flex items-center gap-2 print:hidden flex-none">
                {!isReviewed && !editing && (
                  <button
                    onClick={startEdit}
                    disabled={submitting}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Pencil size={12} /> Rediger
                  </button>
                )}
                <button
                  onClick={exportPDF}
                  disabled={exporting || co.status === 'draft'}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50"
                  title="Markeres som 'Til behandling' og åpner print-dialog"
                >
                  <Printer size={12} /> {exporting ? 'Markerer...' : 'Eksporter PDF'}
                </button>
              </div>
            </div>

            {/* Lines table — shows every product on the EM. Single-line EMs
                render as a one-row table; multi-line ones get all rows. */}
            <div>
              <p className="text-xs text-gray-400 mb-2">Produkter</p>
              <div className="overflow-x-auto rounded border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Produkt</th>
                      <th className="px-3 py-2 text-right font-medium">Mengde</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(lines.length > 0 ? lines : [{ id: co.id, product_id: co.product_id, requested_quantity: co.requested_quantity, unit: co.unit } as unknown as ChangeOrderLine]).map((ln) => {
                      const p = products.find((pp) => pp.id === ln.product_id) ?? null
                      return (
                        <tr key={ln.id}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-gray-900">{fmtProductLabel(p)}</p>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                            {ln.requested_quantity} <span className="text-gray-400">{ln.unit}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-400 mb-1">Begrunnelse</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded p-3 whitespace-pre-line">{co.reason}</p>
            </div>

            <div className="rounded-md bg-blue-50 border border-blue-200 p-4 flex items-baseline justify-between">
              <p className="text-sm font-medium text-blue-900">Totalbeløp (eks. mva)</p>
              <p className="text-2xl font-bold text-blue-900">{fmt(co.total_customer_value)}</p>
            </div>

            {/* Inline edit panel — admin only, hidden in print. The product +
                quantity sit in a 'gammel → ny' table so the change is
                explicit at a glance. */}
            {editing && (
              <div className="print:hidden border-2 border-primary bg-primary-soft rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-primary">Rediger endringsmelding</p>
                  <button
                    type="button"
                    onClick={addEditLine}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-white border border-primary text-primary rounded hover:bg-primary-soft"
                  >
                    <Plus size={12} /> Legg til produkt
                  </button>
                </div>

                {/* Multi-row product table — admin can add, remove and edit
                    each line. Pris-snapshots resolves server-side from
                    each product's customer_price + the UE's price list. */}
                <div className="overflow-x-auto bg-white rounded border border-primary/30">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-600">Produkt</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-600 w-32">Mengde</th>
                        <th className="px-3 py-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editLines.map((ln) => {
                        const prod = products.find((p) => p.id === ln.product_id) ?? null
                        return (
                          <tr key={ln.tempId} className="border-t border-gray-100">
                            <td className="px-3 py-2">
                              <select
                                value={ln.product_id}
                                onChange={(e) => updateEditLine(ln.tempId, { product_id: e.target.value })}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                              >
                                <option value="">Velg produkt...</option>
                                {products.map((p) => (
                                  <option key={p.id} value={p.id}>{fmtProductLabel(p)}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.01"
                                  min="0"
                                  value={ln.requested_quantity}
                                  onChange={(e) => updateEditLine(ln.tempId, { requested_quantity: e.target.value })}
                                  className="w-20 px-2 py-1 text-right text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
                                />
                                <span className="text-gray-400 text-xs w-8">{prod?.unit ?? ''}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => removeEditLine(ln.tempId)}
                                disabled={editLines.length <= 1}
                                className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                title={editLines.length <= 1 ? 'Minst én linje må være igjen' : 'Fjern linje'}
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Begrunnelse</label>
                  <textarea
                    rows={3}
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    className="block w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                {editError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{editError}</p>
                )}
                <p className="text-[10px] text-gray-500">
                  Pris-snapshots resolves serverside fra produktets kundepris og UEs prisliste (faller tilbake til budsjettlinjen om UE-pris mangler). Totaler regnes ut fra disse, endringen logges, og UE ser samme oppdatering — uten kundepris.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    disabled={editSaving}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    <X size={12} /> Avbryt
                  </button>
                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={editSaving}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50"
                  >
                    <Save size={12} /> {editSaving ? 'Lagrer...' : 'Lagre'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Attachment — rides along in the PDF. */}
          {co.attachment_url && (
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm font-medium text-gray-700 mb-3">Vedlegg</p>
              <a
                href={`/api/change-orders/${co.id}/attachment?redirect=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block"
              >
                <img
                  src={`/api/change-orders/${co.id}/attachment?redirect=1`}
                  alt="Vedlegg"
                  className="max-w-full rounded border border-gray-200"
                />
              </a>
            </div>
          )}

          {/* Admin action — hidden in print */}
          {co.status === 'pending' && (
            <div className="print:hidden bg-white rounded-lg shadow p-6 space-y-4">
              <h2 className="text-base font-semibold text-gray-900">Behandle endringsmelding</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kommentar (valgfritt)</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="block w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Legg til en kommentar til underentreprenøren..."
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => handleStatus('rejected')}
                  disabled={submitting}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  Avvis
                </button>
                <button
                  onClick={() => handleStatus('approved')}
                  disabled={submitting}
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Godkjenn
                </button>
              </div>
            </div>
          )}

          {/* Already reviewed — hidden in print */}
          {isReviewed && (
            <div className="print:hidden bg-white rounded-lg shadow p-6 space-y-2">
              <p className="text-sm font-medium text-gray-700">Behandlet av: {co.reviewed_by ?? '–'}</p>
              <p className="text-sm text-gray-500">Dato: {co.reviewed_at?.split('T')[0] ?? '–'}</p>
              {co.admin_comment && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Kommentar</p>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded p-3">{co.admin_comment}</p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* RIGHT — Internt (top) + Versjonslogg (bottom). Both print:hidden. */}
        <aside className="lg:col-span-3 print:hidden space-y-4">
          <div className="bg-white rounded-lg shadow p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Internt — økonomi</h2>
            <p className="text-[10px] text-gray-500 -mt-2">Skjules i PDF og hos UE</p>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">UE-kostpris</dt>
                <dd className="font-medium text-gray-900 tabular-nums">{fmt(co.cost_price_snapshot)}/{co.unit}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Kundepris</dt>
                <dd className="font-medium text-gray-900 tabular-nums">{fmt(co.customer_price_snapshot)}/{co.unit}</dd>
              </div>
              <div className="border-t border-gray-100 pt-2 flex justify-between">
                <dt className="text-gray-500">Total kostnad</dt>
                <dd className="font-semibold text-gray-900 tabular-nums">{fmt(co.total_cost)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Salgsverdi</dt>
                <dd className="font-semibold text-gray-900 tabular-nums">{fmt(co.total_customer_value)}</dd>
              </div>
              <div className="border-t border-gray-100 pt-2 flex justify-between">
                <dt className="text-gray-500">Fortjeneste</dt>
                <dd className={`font-bold tabular-nums ${co.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(co.profit)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Margin</dt>
                <dd className={`font-semibold tabular-nums ${margin >= 15 ? 'text-green-600' : 'text-orange-500'}`}>{margin}%</dd>
              </div>
            </dl>
          </div>

          <div className="bg-white rounded-lg shadow p-5 space-y-3">
            <div className="flex items-center gap-2">
              <History size={14} className="text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-900">Versjonslogg</h2>
            </div>
            {versionEvents.length === 0 ? (
              <p className="text-xs text-gray-400">Ingen endringer ennå</p>
            ) : (
              <ol className="space-y-2">
                {versionEvents.map((ev) => {
                  const hasDiff = !!ev.metadata?.before || !!ev.metadata?.after
                  return (
                    <li key={ev.id}>
                      <button
                        type="button"
                        onClick={() => hasDiff && setDiffEntry(ev)}
                        disabled={!hasDiff}
                        className={`w-full text-left text-xs space-y-0.5 border-l-2 pl-2.5 py-1 rounded-r transition-colors ${
                          hasDiff
                            ? 'border-primary/40 hover:bg-primary-soft cursor-pointer'
                            : 'border-gray-200 cursor-default'
                        }`}
                        title={hasDiff ? 'Klikk for å se gammel vs ny' : undefined}
                      >
                        <p className="font-medium text-gray-900 flex items-center justify-between gap-2">
                          <span>{activityActionLabel(ev.action)}</span>
                          {hasDiff && <span className="text-[10px] text-primary">Se diff →</span>}
                        </p>
                        {ev.comment && (
                          <p className="text-gray-600">{ev.comment}</p>
                        )}
                        <p className="text-gray-400">
                          {ev.actor} · {new Date(ev.created_at).toLocaleString('nb-NO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </aside>
      </main>

      <VersionDiffModal
        entry={diffEntry}
        productNameLookup={(id) => {
          const p = products.find((pp) => pp.id === id)
          return p ? fmtProductLabel(p) : id
        }}
        onClose={() => setDiffEntry(null)}
      />
    </div>
  )
}
