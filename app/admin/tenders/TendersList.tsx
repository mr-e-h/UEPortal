'use client'

import { useRouter } from 'next/navigation'
import { tenderStatus } from '@/lib/statuses'
import type { TenderStatus } from '@/types'

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
  return (
    <div className="overflow-x-auto">
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
          {rows.map((r) => (
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
