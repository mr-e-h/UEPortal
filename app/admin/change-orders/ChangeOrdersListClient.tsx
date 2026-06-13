'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import FilterBar from '@/components/lists/FilterBar'
import { fmtNOK as fmt } from '@/lib/format'
import { changeOrderType, changeOrderStatus } from '@/lib/statuses'
import StatusPill from '@/components/ui/StatusPill'

/**
 * Klientdel av EM-oversikten: prosjekt- og statusfilter over de to listene
 * (Til godkjenning / Behandlede). Radene kommer ferdig oppløst fra RSC-siden —
 * inkl. at `value` (kundeverdi) er null for ikke-økonomiroller, slik at
 * tallet aldri serialiseres til en byggeleders nettleser.
 */

export type EmStatus = 'pending' | 'approved' | 'rejected' | 'revision_requested'

export interface EmRow {
  id: string
  title: string
  em_type: string
  sub_name: string
  sub_id: string
  project_id: string
  /** Kundeverdi — null når innlogget rolle ikke skal se kundeøkonomi. */
  value: number | null
  cost: number
  submitted: string
  status: EmStatus
}

const STATUS_OPTIONS: Array<{ value: 'all' | EmStatus; label: string }> = [
  { value: 'all', label: 'Alle statuser' },
  { value: 'pending', label: 'Venter' },
  { value: 'approved', label: 'Godkjent' },
  { value: 'rejected', label: 'Avvist' },
  { value: 'revision_requested', label: 'Trenger revisjon' },
]

export default function ChangeOrdersListClient({
  rows,
  projects,
  subs,
  showEconomy,
}: {
  rows: EmRow[]
  projects: Array<{ id: string; name: string }>
  subs: Array<{ id: string; name: string }>
  showEconomy: boolean
}) {
  const [search, setSearch] = useState('')
  const [projectId, setProjectId] = useState<string>('all')
  const [subId, setSubId] = useState<string>('all')
  const [status, setStatus] = useState<'all' | EmStatus>('all')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) =>
      (projectId === 'all' || r.project_id === projectId) &&
      (subId === 'all' || r.sub_id === subId) &&
      (status === 'all' || r.status === status) &&
      (q === '' || r.title.toLowerCase().includes(q) || r.sub_name.toLowerCase().includes(q))
    )
  }, [rows, search, projectId, subId, status])

  const pending = filtered.filter((r) => r.status === 'pending')
  const processed = filtered.filter((r) => r.status !== 'pending')

  return (
    <div className="space-y-6">
      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Søk i endringsmeldinger…"
        searchLabel="Søk i endringsmeldinger"
        projects={projects}
        projectId={projectId}
        onProject={setProjectId}
        subs={subs}
        subId={subId}
        onSub={setSubId}
        statusOptions={STATUS_OPTIONS}
        status={status}
        onStatus={(v) => setStatus(v as 'all' | EmStatus)}
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
          <OrderTable rows={pending} showEconomy={showEconomy} />
        </Card>
      )}

      {/* Ventende (pending) rader bor i køen over — her vises resten
          (behandlede + til revisjon), så ingen EM står to ganger. */}
      <Card>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Behandlede endringsmeldinger</h2>
        </div>
        <OrderTable rows={processed} showEconomy={showEconomy} />
      </Card>
    </div>
  )
}

function OrderTable({ rows, showEconomy }: { rows: EmRow[]; showEconomy: boolean }) {
  if (rows.length === 0) {
    return <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Ingen endringsmeldinger</div>
  }
  // Produkt/Mengde er bevisst utelatt: de viste kun FØRSTE linje på
  // flerlinje-EM-er (legacy-felter) og presset tabellen til horisontal
  // scroll. Detaljsiden viser alle linjene korrekt.
  const headers = ['Endringsmelding', 'Type', 'Underentreprenør', ...(showEconomy ? ['Verdi'] : []), 'Kostnad', 'Innsendt', 'Status', '']
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h) => (
              <th
                key={h}
                className={`px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide ${
                  h === 'Verdi' || h === 'Kostnad' ? 'text-right' : ''
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted transition-colors">
              <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">{r.title}</td>
              <td className="px-4 py-2.5">
                {(() => {
                  const t = changeOrderType(r.em_type)
                  return <span className={`text-xs font-medium px-2 py-0.5 rounded ${t.cls}`}>{t.label}</span>
                })()}
              </td>
              <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{r.sub_name}</td>
              {showEconomy && (
                <td className="px-4 py-2.5 text-right text-[var(--color-text-primary)]">
                  {fmt(r.value ?? 0)}
                </td>
              )}
              <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)]">{fmt(r.cost)}</td>
              <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{r.submitted}</td>
              <td className="px-4 py-2.5">
                <StatusPill meta={changeOrderStatus(r.status)} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <Link href={`/admin/change-orders/${r.id}`} className="text-xs text-primary hover:underline font-medium">
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
