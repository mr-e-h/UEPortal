'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import FilterBar from '@/components/lists/FilterBar'
import StatusPill from '@/components/ui/StatusPill'
import { weeklyReportStatus } from '@/lib/statuses'

/**
 * Klientdel av ukesrapport-oversikten: tekstsøk + prosjekt-/UE-/statusfilter
 * over de to listene (Til godkjenning / Behandlede). Radene kommer ferdig
 * oppløst fra RSC-siden — lista inneholder ingen økonomitall.
 */

export type ReportStatus = 'submitted' | 'approved' | 'partially_approved' | 'rejected'

export interface ReportRow {
  id: string
  project_name: string
  project_id: string
  sub_name: string
  sub_id: string
  week_label: string
  submitted: string
  status: ReportStatus
}

const STATUS_OPTIONS: Array<{ value: 'all' | ReportStatus; label: string }> = [
  { value: 'all', label: 'Alle statuser' },
  { value: 'submitted', label: 'Venter' },
  { value: 'approved', label: 'Godkjent' },
  { value: 'partially_approved', label: 'Delvis godkjent' },
  { value: 'rejected', label: 'Avslått' },
]

export default function WeeklyReportsListClient({
  rows,
  projects,
  subs,
}: {
  rows: ReportRow[]
  projects: Array<{ id: string; name: string }>
  subs: Array<{ id: string; name: string }>
}) {
  const [search, setSearch] = useState('')
  const [projectId, setProjectId] = useState<string>('all')
  const [subId, setSubId] = useState<string>('all')
  const [status, setStatus] = useState<'all' | ReportStatus>('all')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) =>
      (projectId === 'all' || r.project_id === projectId) &&
      (subId === 'all' || r.sub_id === subId) &&
      (status === 'all' || r.status === status) &&
      (q === '' ||
        r.project_name.toLowerCase().includes(q) ||
        r.sub_name.toLowerCase().includes(q) ||
        r.week_label.toLowerCase().includes(q))
    )
  }, [rows, search, projectId, subId, status])

  const pending = filtered.filter((r) => r.status === 'submitted')
  const processed = filtered.filter((r) => r.status !== 'submitted')

  return (
    <div className="space-y-6">
      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Søk i rapporter…"
        searchLabel="Søk i rapporter"
        projects={projects}
        projectId={projectId}
        onProject={setProjectId}
        subs={subs}
        subId={subId}
        onSub={setSubId}
        statusOptions={STATUS_OPTIONS}
        status={status}
        onStatus={(v) => setStatus(v as 'all' | ReportStatus)}
        matchCount={filtered.length}
      />

      {pending.length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Til godkjenning</h2>
            <span className="bg-primary text-white text-xs font-medium px-1.5 py-0.5 rounded-full">
              {pending.length}
            </span>
          </div>
          <ReportTable rows={pending} />
        </Card>
      )}

      {/* Ventende rader bor i køen over — her vises kun ferdigbehandlede,
          så ingen rapport står to ganger på samme skjerm. */}
      <Card>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Behandlede rapporter</h2>
        </div>
        <ReportTable rows={processed} />
      </Card>
    </div>
  )
}

function ReportTable({ rows }: { rows: ReportRow[] }) {
  if (rows.length === 0) {
    return <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Ingen rapporter</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Prosjekt', 'Underentreprenør', 'Uke', 'Innsendt', 'Status', ''].map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted transition-colors">
              <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">{r.project_name}</td>
              <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{r.sub_name}</td>
              <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{r.week_label}</td>
              <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{r.submitted}</td>
              <td className="px-4 py-2.5">
                {/* Ord og farger fra status-modulen — én kilde for alle statuser. */}
                <StatusPill meta={weeklyReportStatus(r.status)} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <Link
                  href={`/admin/weekly-reports/${r.id}`}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Detaljer →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
