'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { tenderStatus } from '@/lib/statuses'
import type { TenderStatus } from '@/types'

/** Avsluttede anbud (kansellert/lukket) skjules som standard — de er
 *  historikk, ikke arbeidskø. Toggle viser dem ved behov. */
const ARCHIVED_STATUSES: TenderStatus[] = ['cancelled', 'closed']

type Row = {
  id: string
  title: string
  status: TenderStatus
  deadline_at: string | null
  project_name: string
  project_number: string
  invited: number
  answered: number
}

function fmtDeadline(iso: string | null): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
}

/**
 * A coloured status chip for a tender. Reuses the shared tenderStatus() meta
 * (label + tailwind classes) rather than the Badge component, since the
 * tender status set is wider than Badge's union.
 */
function TenderChip({ status }: { status: string }) {
  const meta = tenderStatus(status)
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>{meta.label}</span>
}

export default function TendersList({ rows }: { rows: Row[] }) {
  const router = useRouter()
  const [showArchived, setShowArchived] = useState(false)
  const archivedCount = rows.filter((r) => ARCHIVED_STATUSES.includes(r.status)).length
  const visibleRows = showArchived ? rows : rows.filter((r) => !ARCHIVED_STATUSES.includes(r.status))

  return (
    <div className="overflow-x-auto">
      {archivedCount > 0 && (
        <div className="px-4 py-2 border-b border-border flex justify-end">
          <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded"
            />
            Vis avsluttede ({archivedCount})
          </label>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {['Tittel', 'Prosjekt', 'Status', 'Svarfrist', 'Svar', ''].map((h) => (
              <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => (
            <tr
              key={r.id}
              onClick={() => router.push(`/admin/tenders/${r.id}`)}
              className="border-b border-border last:border-0 hover:bg-muted transition-colors cursor-pointer"
            >
              <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">{r.title}</td>
              <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">
                {r.project_name}
                {r.project_number && <span className="text-[var(--color-text-muted)] ml-1">· {r.project_number}</span>}
              </td>
              <td className="px-4 py-2.5"><TenderChip status={r.status} /></td>
              <td className="px-4 py-2.5 text-[var(--color-text-muted)] whitespace-nowrap">{fmtDeadline(r.deadline_at)}</td>
              <td className="px-4 py-2.5 text-[var(--color-text-secondary)] whitespace-nowrap">
                {r.answered} / {r.invited}
              </td>
              <td className="px-4 py-2.5 text-right">
                <span className="text-xs text-primary hover:underline font-medium">Åpne →</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
