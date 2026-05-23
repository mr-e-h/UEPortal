'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Trash2, Mail, Phone, Building2 } from 'lucide-react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import ConfirmDialog from '@/components/ConfirmDialog'
import { roleLabel } from '@/lib/roles'
import type { AccessRequest, AccessRequestStatus } from '@/types'

type Filter = AccessRequestStatus | 'all'

interface Props {
  initialRequests: AccessRequest[]
  initialFilter?: Filter
}

export default function AccessRequestsClient({ initialRequests, initialFilter = 'pending' }: Props) {
  const router = useRouter()
  const [requests, setRequests] = useState<AccessRequest[]>(initialRequests)
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  async function load(f: Filter) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/access-requests?status=${f}`)
      if (!res.ok) throw new Error((await res.json()).error ?? 'Klarte ikke å laste')
      setRequests(await res.json())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Skip the first load — initial data already shipped with the SSR HTML.
  // Re-fetch only when the user changes the filter tab.
  const skipFirst = useRef(true)
  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return }
    load(filter)
  }, [filter])

  async function handleApprove(req: AccessRequest) {
    setBusyId(req.id)
    setError(null)
    const role = req.desired_role ?? 'subcontractor'
    const res = await fetch(`/api/access-requests/${req.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', role }),
    })
    setBusyId(null)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Godkjenning feilet')
      return
    }
    await load(filter)
    router.refresh()
  }

  async function handleReject(id: string, note: string) {
    setBusyId(id)
    setError(null)
    const res = await fetch(`/api/access-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', note: note.trim() || null }),
    })
    setBusyId(null)
    setRejectingId(null)
    setRejectNote('')
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Avslag feilet')
      return
    }
    await load(filter)
    router.refresh()
  }

  async function handleDelete(id: string) {
    setBusyId(id)
    const res = await fetch(`/api/access-requests/${id}`, { method: 'DELETE' })
    setBusyId(null)
    setConfirmDeleteId(null)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Sletting feilet')
      return
    }
    await load(filter)
    router.refresh()
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Tilgangsforespørsler</h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Brukere som har bedt om tilgang via innloggingssiden. Godkjenner du, sendes en invitasjonslenke til e-posten.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {(['pending', 'approved', 'rejected', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                filter === f
                  ? 'bg-primary text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-muted'
              }`}
            >
              {f === 'pending' ? 'Ventende' : f === 'approved' ? 'Godkjent' : f === 'rejected' ? 'Avslått' : 'Alle'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-[var(--color-text-muted)]">Laster...</div>
      ) : requests.length === 0 ? (
        <Card className="p-10 text-center text-sm text-[var(--color-text-muted)]">
          {filter === 'pending' ? 'Ingen ventende forespørsler' : 'Ingen forespørsler'}
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-[260px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">{r.full_name}</span>
                    <StatusBadge status={r.status} />
                    {r.desired_role && (
                      <span className="text-xs text-[var(--color-text-muted)]">
                        Ønsker: <span className="text-[var(--color-text-secondary)]">{roleLabel(r.desired_role)}</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
                    <span className="inline-flex items-center gap-1"><Mail size={11} /> {r.email}</span>
                    {r.company && <span className="inline-flex items-center gap-1"><Building2 size={11} /> {r.company}</span>}
                    {r.phone && <span className="inline-flex items-center gap-1"><Phone size={11} /> {r.phone}</span>}
                  </div>
                  {r.message && (
                    <p className="mt-2 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap border-l-2 border-border pl-3">
                      {r.message}
                    </p>
                  )}
                  <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">
                    Mottatt {new Date(r.created_at).toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' })}
                    {r.decided_at && ` · Behandlet ${new Date(r.decided_at).toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' })}`}
                  </p>
                  {r.decision_note && (
                    <p className="mt-1 text-xs italic text-[var(--color-text-muted)]">Notat: {r.decision_note}</p>
                  )}
                </div>

                {r.status === 'pending' ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      className="px-3 py-1.5 text-xs inline-flex items-center gap-1"
                      onClick={() => handleApprove(r)}
                      disabled={busyId === r.id}
                    >
                      <Check size={13} /> Godkjenn
                    </Button>
                    <button
                      onClick={() => { setRejectingId(r.id); setRejectNote('') }}
                      disabled={busyId === r.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-muted hover:bg-gray-200 text-[var(--color-text-primary)] rounded-lg font-medium disabled:opacity-40"
                    >
                      <X size={13} /> Avslå
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(r.id)}
                    disabled={busyId === r.id}
                    className="text-[var(--color-text-muted)] hover:text-danger disabled:opacity-40"
                    title="Slett forespørsel"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {rejectingId === r.id && (
                <div className="mt-4 border-t border-border pt-3 space-y-2">
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                    Notat (valgfritt — vises ikke til brukeren)
                  </label>
                  <textarea
                    rows={2}
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => { setRejectingId(null); setRejectNote('') }}
                      className="px-3 py-1.5 text-xs bg-muted hover:bg-gray-200 text-[var(--color-text-primary)] rounded-lg font-medium"
                    >
                      Avbryt
                    </button>
                    <button
                      onClick={() => handleReject(r.id, rejectNote)}
                      disabled={busyId === r.id}
                      className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-40"
                    >
                      Bekreft avslag
                    </button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Slett forespørsel?"
          message="Forespørselen slettes permanent. Dette kan ikke angres."
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: AccessRequestStatus }) {
  const cls =
    status === 'pending' ? 'bg-amber-50 text-amber-700'
    : status === 'approved' ? 'bg-green-50 text-green-700'
    : 'bg-gray-100 text-gray-600'
  const label = status === 'pending' ? 'Ventende' : status === 'approved' ? 'Godkjent' : 'Avslått'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
  )
}
