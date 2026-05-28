'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Pencil, X, Save, Printer, History } from 'lucide-react'
import type { ChangeOrder, Project, Product, Subcontractor, ActivityEntry } from '@/types'
import { fmtNOK as fmt } from '@/lib/format'
import { changeOrderStatus } from '@/lib/statuses'
import { activityActionLabel } from '@/lib/activity-actions'
import { useMe } from '@/lib/useMe'

/**
 * Admin EM-detail layout — three columns:
 *
 *   LEFT  (Versjonslogg)  Cost change history + status changes. Visible to
 *                         admin/PM and to sub on their mirror page. Hidden
 *                         in print/PDF output.
 *   CENTER (Kundedel)     The customer-facing slice: project, product,
 *                         qty, reason, attachment, salgsverdi. This is
 *                         what 'Eksporter PDF' actually outputs — admin
 *                         can print/save this directly and forward to
 *                         the end customer without leaking cost or
 *                         margin numbers.
 *   RIGHT (Internt)       Cost + customer-price + profit + margin. Visible
 *                         to admin only; hidden in print.
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
  const [newComment, setNewComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Inline edit for qty + reason. Allowed for draft + pending (admin).
  // approved/rejected must be reverted ('Angre') first.
  const [editing, setEditing] = useState(false)
  const [editQty, setEditQty] = useState('')
  const [editReason, setEditReason] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  const load = useCallback(async () => {
    const [orders, projects, products, subs, activityData] = await Promise.all([
      fetch(`/api/change-orders?id=${id}`).then((r) => r.json()),
      fetch('/api/projects').then((r) => r.json()),
      fetch('/api/products').then((r) => r.json()),
      fetch('/api/subcontractors').then((r) => r.json()),
      fetch(`/api/activity?entity_id=${id}&entity_type=change_order`).then((r) => r.json()),
    ])
    const found: ChangeOrder = orders[0] ?? null
    setCo(found)
    if (found) {
      setProject((projects as Project[]).find((p) => p.id === found.project_id) ?? null)
      setProduct((products as Product[]).find((p) => p.id === found.product_id) ?? null)
      setSub((subs as Subcontractor[]).find((s) => s.id === found.subcontractor_id) ?? null)
      setComment(found.admin_comment ?? '')
    }
    setActivity(Array.isArray(activityData) ? activityData : [])
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
    setEditQty(String(co.requested_quantity))
    setEditReason(co.reason ?? '')
    setEditError(null)
    setEditing(true)
  }

  async function saveEdit() {
    setEditSaving(true)
    setEditError(null)
    const qty = Number(editQty)
    if (!Number.isFinite(qty) || qty <= 0) {
      setEditError('Mengde må være et positivt tall')
      setEditSaving(false)
      return
    }
    const res = await fetch(`/api/change-orders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requested_quantity: qty, reason: editReason }),
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

  async function submitComment(e: React.FormEvent) {
    e.preventDefault()
    if (!newComment.trim()) return
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_type: 'change_order',
        entity_id: id,
        action: 'commented',
        actor: adminName,
        comment: newComment.trim(),
      }),
    })
    setNewComment('')
    await load()
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">Laster...</div>
  if (!co) return <div className="min-h-screen flex items-center justify-center text-gray-500">Endringsmelding ikke funnet</div>

  const statusMeta = changeOrderStatus(co.status)
  const isReviewed = co.status !== 'pending'
  const margin = co.total_customer_value > 0
    ? Math.round((co.profit / co.total_customer_value) * 100)
    : 0

  // Versjonslogg events: edits + status changes + reverts. Skip plain comments
  // (those have their own UI). Newest first.
  const versionEvents = activity
    .filter((a) => a.action !== 'commented')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      {/* Print stylesheet — hides nav, sidebars, action panels, header chrome */}
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
            <span className={`text-xs px-2 py-0.5 rounded ${statusMeta.cls}`}>
              {statusMeta.label}
            </span>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 px-3 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
              title="Skriv ut eller lagre som PDF — kun kundedel"
            >
              <Printer size={12} /> Eksporter PDF
            </button>
            {!isReviewed && !editing && (
              <button
                onClick={startEdit}
                disabled={submitting}
                className="inline-flex items-center gap-1 px-3 py-1 text-xs bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50"
              >
                <Pencil size={12} /> Rediger
              </button>
            )}
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
        {/* LEFT — Versjonslogg */}
        <aside className="lg:col-span-3 print:hidden">
          <div className="bg-white rounded-lg shadow p-5 space-y-3">
            <div className="flex items-center gap-2">
              <History size={14} className="text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-900">Versjonslogg</h2>
            </div>
            {versionEvents.length === 0 ? (
              <p className="text-xs text-gray-400">Ingen endringer ennå</p>
            ) : (
              <ol className="space-y-3">
                {versionEvents.map((ev) => (
                  <li key={ev.id} className="text-xs space-y-0.5 border-l-2 border-gray-200 pl-2.5">
                    <p className="font-medium text-gray-900">{activityActionLabel(ev.action)}</p>
                    {ev.comment && (
                      <p className="text-gray-600">{ev.comment}</p>
                    )}
                    <p className="text-gray-400">
                      {ev.actor} · {new Date(ev.created_at).toLocaleString('nb-NO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>

        {/* CENTER — Kundedel (printable as PDF) */}
        <section className="lg:col-span-6 space-y-6">
          {/* Customer-facing summary card — this is the part the PDF renders. */}
          <div className="bg-white rounded-lg shadow p-6 space-y-5">
            <div className="border-b border-gray-100 pb-3">
              <p className="text-xs text-gray-400">Endringsmelding</p>
              <h2 className="text-lg font-bold text-gray-900">{project?.name ?? '–'}</h2>
              <p className="text-xs text-gray-500">
                Prosjektnummer: {project?.project_number ?? '–'}
                {co.submitted_at && ` · Innsendt ${co.submitted_at.split('T')[0]}`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-400">Produkt</p>
                <p className="font-medium text-gray-900">{product?.name ?? '–'}</p>
                {product?.description && (
                  <p className="text-xs text-gray-500 mt-0.5">{product.description}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400">Mengde</p>
                <p className="font-medium text-gray-900">{co.requested_quantity} {co.unit}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-gray-400 mb-1">Begrunnelse</p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded p-3 whitespace-pre-line">{co.reason}</p>
              </div>
            </div>

            {/* The single number that goes on the invoice to the end customer. */}
            <div className="rounded-md bg-blue-50 border border-blue-200 p-4 flex items-baseline justify-between">
              <p className="text-sm font-medium text-blue-900">Totalbeløp (eks. mva)</p>
              <p className="text-2xl font-bold text-blue-900">{fmt(co.total_customer_value)}</p>
            </div>
          </div>

          {/* Attachment — visible in print so contractor signatures or
              drawings ride along with the PDF. */}
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

          {/* Inline edit panel — admin only, hidden in print */}
          {editing && (
            <div className="print:hidden border-2 border-primary bg-primary-soft rounded-lg p-4 space-y-3">
              <p className="text-sm font-semibold text-primary">Rediger endringsmelding</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Mengde ({co.unit})</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={editQty}
                    onChange={(e) => setEditQty(e.target.value)}
                    className="block w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Begrunnelse</label>
                  <textarea
                    rows={3}
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    className="block w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              {editError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{editError}</p>
              )}
              <p className="text-[10px] text-gray-500">
                Endringer logges i versjonsloggen og bruker opprinnelige pris-snapshots. UE som har sendt EM-en ser samme oppdaterte verdier på sin side, men aldri kundepris eller fortjeneste.
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

          {/* Comments thread — admin-side, hidden in print */}
          <div className="print:hidden bg-white rounded-lg shadow p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Kommentarer</h2>
            {activity.filter((a) => a.action === 'commented').length === 0 ? (
              <p className="text-sm text-gray-400">Ingen kommentarer ennå</p>
            ) : (
              <ul className="space-y-2">
                {activity.filter((a) => a.action === 'commented').map((ev) => (
                  <li key={ev.id} className="text-sm border-l-2 border-blue-200 pl-3 py-1">
                    <p className="text-gray-700">{ev.comment}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {ev.actor} · {new Date(ev.created_at).toLocaleString('nb-NO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={submitComment} className="flex gap-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Skriv kommentar..."
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="submit"
                disabled={!newComment.trim()}
                className="px-4 py-2 text-sm bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </div>
        </section>

        {/* RIGHT — Intern økonomi (admin only, hidden in print) */}
        <aside className="lg:col-span-3 print:hidden">
          <div className="bg-white rounded-lg shadow p-5 space-y-4 sticky top-4">
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
        </aside>
      </main>
    </div>
  )
}
