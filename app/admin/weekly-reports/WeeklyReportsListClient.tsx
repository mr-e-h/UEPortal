'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

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
  const hasFilter = search.trim() !== '' || projectId !== 'all' || subId !== 'all' || status !== 'all'

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

  const selectCls = 'px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary'

  return (
    <div className="space-y-6">
      {/* Filterbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Søk i rapporter…"
          aria-label="Søk i rapporter"
          className={`${selectCls} w-56`}
        />
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={selectCls} aria-label="Filtrer på prosjekt">
          <option value="all">Alle prosjekter</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select value={subId} onChange={(e) => setSubId(e.target.value)} className={selectCls} aria-label="Filtrer på underentreprenør">
          <option value="all">Alle UE</option>
          {subs.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | ReportStatus)} className={selectCls} aria-label="Filtrer på status">
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {hasFilter && (
          <button
            type="button"
            onClick={() => { setSearch(''); setProjectId('all'); setSubId('all'); setStatus('all') }}
            className="px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft rounded-md"
          >
            Nullstill
          </button>
        )}
        {hasFilter && (
          <span className="text-xs text-[var(--color-text-muted)]">
            {filtered.length} treff
          </span>
        )}
      </div>

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
                {/* Delvis godkjent er ferdigbehandlet — grønn, ikke gul «Venter». */}
                <Badge
                  status={
                    r.status === 'approved' || r.status === 'partially_approved' ? 'approved'
                    : r.status === 'rejected' ? 'rejected'
                    : 'pending'
                  }
                />
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
