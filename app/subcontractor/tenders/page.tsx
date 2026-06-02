'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMe } from '@/lib/useMe'
import Card from '@/components/ui/Card'
import { tenderInvitationStatus } from '@/lib/statuses'
import { fmtNOK } from '@/lib/format'

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
}

function fmtDeadline(iso: string | null): string {
  if (!iso) return 'Ingen frist'
  const d = new Date(iso)
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' kl. ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
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

  return (
    <div className="p-6 space-y-6">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((r) => {
            const invMeta = tenderInvitationStatus(r.invitation_status)
            const canPrice = !r.expired && (r.status === 'sent' || r.status === 'open')
            return (
              <button
                key={r.id}
                onClick={() => router.push(`/subcontractor/tenders/${r.id}`)}
                className="text-left"
              >
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
          })}
        </div>
      )}
    </div>
  )
}
