'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { ChangeOrder, Project, Product, Subcontractor, ActivityEntry } from '@/types'
import { fmtNOK as fmt } from '@/lib/format'
import { changeOrderStatus } from '@/lib/statuses'
import { activityActionLabel } from '@/lib/activity-actions'

export default function ChangeOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [co, setCo] = useState<ChangeOrder | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [sub, setSub] = useState<Subcontractor | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [comment, setComment] = useState('')
  const [newComment, setNewComment] = useState('')
  const [adminName, setAdminName] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

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

  useEffect(() => {
    setAdminName(localStorage.getItem('user_name') ?? 'Admin')
    load()
  }, [load])

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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/admin" className="text-gray-400 hover:text-gray-600 text-sm">← Dashboard</Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Endringsmelding</h1>
            <p className="text-sm text-gray-500">{project?.name ?? '–'} · {sub?.company_name ?? '–'}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded ${statusMeta.cls}`}>
              {statusMeta.label}
            </span>
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

      <main className="px-4 sm:px-6 py-8 space-y-6">
        {/* Details */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-xs text-gray-400">Prosjekt</p><p className="font-medium text-gray-900">{project?.name ?? '–'} ({project?.project_number})</p></div>
            <div><p className="text-xs text-gray-400">Underentreprenør</p><p className="font-medium text-gray-900">{sub?.company_name ?? '–'}</p></div>
            <div><p className="text-xs text-gray-400">Produkt</p><p className="font-medium text-gray-900">{product?.name ?? '–'}</p><p className="text-xs text-gray-500">{product?.description ?? ''}</p></div>
            <div><p className="text-xs text-gray-400">Ønsket mengde</p><p className="font-medium text-gray-900">{co.requested_quantity} {co.unit}</p></div>
            <div><p className="text-xs text-gray-400">Innsendt</p><p className="font-medium text-gray-900">{co.submitted_at?.split('T')[0] ?? '–'}</p></div>
            <div><p className="text-xs text-gray-400">Kostpris</p><p className="font-medium text-gray-900">{fmt(co.cost_price_snapshot)} / {co.unit}</p></div>
          </div>

          <div className="grid grid-cols-3 gap-4 bg-gray-50 rounded p-4">
            <div><p className="text-xs text-gray-400">Total kostnad</p><p className="font-semibold text-gray-900">{fmt(co.total_cost)}</p></div>
            <div><p className="text-xs text-gray-400">Salgsverdi</p><p className="font-semibold text-gray-900">{fmt(co.total_customer_value)}</p></div>
            <div><p className="text-xs text-gray-400">Fortjeneste</p><p className="font-semibold text-green-600">{fmt(co.profit)}</p></div>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-1">Begrunnelse</p>
            <p className="text-sm text-gray-700 bg-gray-50 rounded p-3">{co.reason}</p>
          </div>
        </div>

        {/* Attachment */}
        {co.attachment_url && (
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm font-medium text-gray-700 mb-3">Vedlegg</p>
            <img src={co.attachment_url} alt="Vedlegg" className="max-w-full rounded border border-gray-200" />
          </div>
        )}

        {/* Admin action */}
        {co.status === 'pending' && (
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
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

        {/* Already reviewed */}
        {isReviewed && (
          <div className="bg-white rounded-lg shadow p-6 space-y-2">
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

        {/* Activity log + comments */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Handlingslogg</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-gray-400">Ingen handlinger ennå</p>
          ) : (
            <ol className="space-y-2">
              {activity.map((entry) => (
                <li key={entry.id} className="flex gap-3 text-sm">
                  <span className="text-gray-400 text-xs mt-0.5 whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                  <span>
                    <span className="font-medium text-gray-800">{entry.actor}</span>
                    {' '}
                    <span className="text-gray-600">{activityActionLabel(entry.action)}</span>
                    {entry.comment && (
                      <span className="text-gray-500"> — &quot;{entry.comment}&quot;</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {/* Comment input */}
          <form onSubmit={submitComment} className="flex gap-2 pt-2 border-t border-gray-100">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Skriv en kommentar..."
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!newComment.trim()}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
