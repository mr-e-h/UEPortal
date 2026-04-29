'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { CheckCircle, XCircle } from 'lucide-react'

export type PendingRow = {
  id: string
  project_name: string
  sub_name: string
  week_label: string
  submission_number: number
  line_count: number
  total_cost: number
  total_sales: number
  submitted_at: string
}

function fmt(n: number) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(n)
}

export default function PendingTable({ rows }: { rows: PendingRow[] }) {
  const router = useRouter()
  const [adminName, setAdminName] = useState('Admin')
  const [loading, setLoading] = useState<Record<string, 'approve' | 'reject' | null>>({})
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    setAdminName(localStorage.getItem('user_name') ?? 'Admin')
  }, [])

  const visibleRows = rows.filter((r) => !dismissed.has(r.id))

  async function handleAction(id: string, action: 'approve_all' | 'reject_all') {
    setLoading((p) => ({ ...p, [id]: action === 'approve_all' ? 'approve' : 'reject' }))
    try {
      await fetch(`/api/weekly-reports/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewed_by: adminName }),
      })
      setDismissed((p) => new Set(Array.from(p).concat(id)))
      router.refresh()
    } finally {
      setLoading((p) => ({ ...p, [id]: null }))
    }
  }

  if (visibleRows.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
        Ingen ukerapporter venter godkjenning
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Prosjekt', 'Underentreprenør', 'Uke', '#', 'Kostnad', 'Salgsverdi', 'Innsendt', ''].map((h) => (
              <th
                key={h}
                className={`px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide ${
                  h === 'Kostnad' || h === 'Salgsverdi' ? 'text-right' : ''
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => {
            const rowLoading = loading[r.id]
            return (
              <tr
                key={r.id}
                onClick={() => router.push(`/admin/weekly-reports/${r.id}`)}
                className="border-b border-border last:border-0 hover:bg-muted cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{r.project_name}</td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">{r.sub_name}</td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">{r.week_label}</td>
                <td className="px-4 py-3 text-[var(--color-text-muted)]">#{r.submission_number}</td>
                <td className="px-4 py-3 text-right text-[var(--color-text-primary)]">{fmt(r.total_cost)}</td>
                <td className="px-4 py-3 text-right font-medium text-[var(--color-text-primary)]">{fmt(r.total_sales)}</td>
                <td className="px-4 py-3 text-[var(--color-text-muted)]">{r.submitted_at}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAction(r.id, 'approve_all')}
                      disabled={!!rowLoading}
                      title="Godkjenn alle"
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-success-soft text-[var(--color-success)] hover:bg-[var(--color-success)] hover:text-white transition-colors disabled:opacity-40"
                    >
                      {rowLoading === 'approve' ? (
                        <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <CheckCircle size={13} />
                      )}
                      Godkjenn
                    </button>
                    <button
                      onClick={() => handleAction(r.id, 'reject_all')}
                      disabled={!!rowLoading}
                      title="Avslå alle"
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-danger-soft text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white transition-colors disabled:opacity-40"
                    >
                      {rowLoading === 'reject' ? (
                        <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <XCircle size={13} />
                      )}
                      Avslå
                    </button>
                    <Link
                      href={`/admin/weekly-reports/${r.id}`}
                      className="text-xs text-primary hover:underline font-medium"
                    >
                      Detaljer →
                    </Link>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
