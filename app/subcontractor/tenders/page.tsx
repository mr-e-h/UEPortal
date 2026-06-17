'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMe } from '@/lib/useMe'
import Card from '@/components/ui/Card'
import { tenderInvitationStatus } from '@/lib/statuses'
import { fmtNOK, fmtDeadline, daysUntil } from '@/lib/format'

type Row = {
  id: string
  title: string
  status: string
  deadline_at: string | null
  expired: boolean
  project_name: string
  project_number: string
  invitation_status: string
  my_bid_status: string | null
  my_bid_total: number | null
  my_bid_submitted_at: string | null
  line_count: number
}

/**
 * Relativ frist-badge: «I dag» / «I morgen» / «Om N dager» / «N dager forsinket».
 * Fargen følger nærheten — rød ved forfalt, oransje når det haster (≤ 3 dager),
 * ellers nøytral. null deadline gir ingen badge.
 */
function deadlineBadge(deadlineAt: string | null): { label: string; cls: string } | null {
  const days = daysUntil(deadlineAt)
  if (days === null) return null
  if (days < 0) {
    const n = Math.abs(days)
    return { label: `${n} ${n === 1 ? 'dag' : 'dager'} forsinket`, cls: 'bg-red-100 text-red-700' }
  }
  if (days === 0) return { label: 'Frist i dag', cls: 'bg-red-100 text-red-700' }
  if (days === 1) return { label: 'Frist i morgen', cls: 'bg-orange-100 text-orange-700' }
  if (days <= 3) return { label: `Om ${days} dager`, cls: 'bg-orange-100 text-orange-700' }
  return { label: `Om ${days} dager`, cls: 'bg-gray-100 text-gray-600' }
}

export default function SubcontractorTendersPage() {
  const router = useRouter()
  const { me } = useMe()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!me) return
    if (me.role !== 'sub') { router.replace('/login'); return }
    fetch('/api/subcontractor/tenders')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Row[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [me, router])

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Laster…</div>
  }

  // Tre arbeidskøer, nærmeste frist først (server sorterer allerede på deadline_at).
  // Et innsendt tilbud hører hjemme under «Sendt inn» selv om fristen er ute, så det
  // ikke forsvinner ned i «Utløpt». Resten av de utløpte er anbud UE aldri svarte på.
  const submitted = rows.filter((r) => r.my_bid_status === 'submitted')
  const expired = rows.filter((r) => r.my_bid_status !== 'submitted' && r.expired)
  const needsAnswer = rows.filter((r) => r.my_bid_status !== 'submitted' && !r.expired)

  const sections: Array<{ key: string; title: string; hint: string; items: Row[] }> = [
    { key: 'needs', title: 'Trenger svar', hint: 'Anbud som venter på din pris', items: needsAnswer },
    { key: 'submitted', title: 'Sendt inn', hint: 'Tilbud du har levert', items: submitted },
    { key: 'expired', title: 'Utløpt', hint: 'Frist gått ut uten innsendt tilbud', items: expired },
  ]

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Tilbudsforespørsler</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Prosjekter du er invitert til å gi pris på
        </p>
      </div>

      {rows.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">Du har ingen tilbudsforespørsler akkurat nå.</p>
        </Card>
      ) : (
        sections
          .filter((s) => s.items.length > 0)
          .map((s) => (
            <section key={s.key} className="space-y-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{s.title}</h2>
                <span className="text-xs text-[var(--color-text-muted)]">{s.items.length}</span>
                <span className="text-xs text-[var(--color-text-muted)]">· {s.hint}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {s.items.map((r) => (
                  <TenderCard key={r.id} row={r} onOpen={() => router.push(`/subcontractor/tenders/${r.id}`)} />
                ))}
              </div>
            </section>
          ))
      )}
    </div>
  )
}

function TenderCard({ row: r, onOpen }: { row: Row; onOpen: () => void }) {
  const invMeta = tenderInvitationStatus(r.invitation_status)
  const canPrice = !r.expired && (r.status === 'sent' || r.status === 'open')
  // Relativ frist kun mens anbudet lever — for innsendte/utløpte er nedtellingen irrelevant.
  const relBadge = canPrice ? deadlineBadge(r.deadline_at) : null
  return (
    <button onClick={onOpen} className="text-left">
      <Card className="p-5 hover:shadow-md transition-shadow h-full">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="font-semibold text-[var(--color-text-primary)]">{r.title || r.project_name}</h2>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-none ${invMeta.cls}`}>
            {invMeta.label}
          </span>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {r.project_name}{r.project_number ? ` · ${r.project_number}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {relBadge && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${relBadge.cls}`}>
              {relBadge.label}
            </span>
          )}
          <span className="text-xs text-[var(--color-text-muted)]">
            {r.line_count} {r.line_count === 1 ? 'linje' : 'linjer'} å prise
          </span>
        </div>
        <p className={`text-sm mt-2 ${r.expired ? 'text-orange-600 font-medium' : 'text-[var(--color-text-muted)]'}`}>
          Svarfrist: {fmtDeadline(r.deadline_at)}{r.expired ? ' (utløpt)' : ''}
        </p>
        {r.my_bid_status === 'submitted' && r.my_bid_total != null && (
          <p className="text-sm text-green-700 mt-1">Ditt tilbud: {fmtNOK(r.my_bid_total)}</p>
        )}
        <p className="text-xs text-primary mt-3 font-medium">
          {canPrice ? 'Gi pris →' : 'Se tilbud →'}
        </p>
      </Card>
    </button>
  )
}
