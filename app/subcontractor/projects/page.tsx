'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, FileText, ClipboardList, AlertTriangle } from 'lucide-react'
import type { BadgeStatus } from '@/components/ui/Badge'
import Badge from '@/components/ui/Badge'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import SortableTable from '@/components/SortableTable'
import type { Column } from '@/components/SortableTable'
import { fmtNOK as fmt, fmtDateShort as fmtDate, daysUntil } from '@/lib/format'
import { useMe } from '@/lib/useMe'

type BudgetLine = {
  id: string
  product_id: string
  product_name: string
  unit: string
  budget_quantity: number
  subcontractor_cost_price_snapshot: number
}

type ProjectManager = { id: string; full_name: string; email: string }

type ProjectWithLines = {
  id: string
  name: string
  project_number: string
  customer: string
  county: string
  status: string
  start_date: string
  end_date: string | null
  budget_lines: BudgetLine[]
  project_managers: ProjectManager[]
  /** UE-eget kostbudsjett (ordreverdi på kostsiden), ferdig summert server-side. */
  budget_value: number
  /** Sum of approved work cost (weekly-report lines + approved EMs). */
  approved_value: number
  /** Sum of ue_invoices.amount tagged to this project. */
  invoiced_value: number
  /** EM-er som venter på admin. */
  pending_em_count: number
  /** Ukesrapporter som venter på admin. */
  pending_weekly_count: number
  /** EM-er admin har sendt tilbake — UEs egen oppgave. */
  revision_count: number
}

type ProjectRow = {
  id: string
  name: string
  project_number: string
  customer: string
  county: string
  status: string
  budget_value: number
  approved_value: number
  /** budget_value − approved_value; kan bli negativ (godkjente EM > opprinnelig ordre). */
  remaining_value: number
  /** approved_value / budget_value i prosent (0 når budsjettet er 0). */
  progress_pct: number
  invoiced_value: number
  end_date: string | null
  pending_em_count: number
  pending_weekly_count: number
  revision_count: number
  /** Sortverdi for saks-kolonnen: revisjon vektes høyest. */
  attention_rank: number
  line_count: number
  contact: { full_name: string; email: string } | null
  contact_label: string
  start_date: string
}

type StatusFilter = 'all' | 'active' | 'completed' | 'archived'

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: 'active', label: 'Aktive' },
  { key: 'completed', label: 'Fullført' },
  { key: 'archived', label: 'Arkivert' },
  { key: 'all', label: 'Alle' },
]

/**
 * Dedicated projects list for subs — separated from the dashboard so the
 * sub can do focused project navigation (search, status filter) without
 * the KPI / pending-approval noise.
 */
export default function SubcontractorProjectsPage() {
  const router = useRouter()
  const { me } = useMe()
  const [projects, setProjects] = useState<ProjectWithLines[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  async function safeJsonArray<T>(input: string): Promise<T[]> {
    try {
      const res = await fetch(input)
      if (!res.ok) return []
      const data = await res.json()
      return Array.isArray(data) ? data as T[] : []
    } catch {
      return []
    }
  }

  const fetchAll = useCallback(async (subId: string) => {
    const proj = await safeJsonArray<ProjectWithLines>(`/api/subcontractor/projects?subcontractor_id=${subId}`)
    setProjects(proj)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!me) return
    // Server layout is the authoritative role gate; don't redirect here or we
    // race the ViewAsBar navigation when exiting view-as. Just skip the fetch.
    if (me.role !== 'sub') return
    if (!me.subcontractor_id) { setLoading(false); return }
    fetchAll(me.subcontractor_id)
  }, [me, router, fetchAll])

  const rows: ProjectRow[] = useMemo(() => projects.map((p) => {
    const pm = p.project_managers?.[0] ?? null
    const extra = p.project_managers && p.project_managers.length > 1 ? ` (+${p.project_managers.length - 1})` : ''
    const budget = p.budget_value
    const approved = p.approved_value
    return {
      id: p.id,
      name: p.name,
      project_number: p.project_number,
      customer: p.customer,
      county: p.county,
      status: p.status,
      budget_value: budget,
      approved_value: approved,
      remaining_value: budget - approved,
      progress_pct: budget > 0 ? Math.round((approved / budget) * 100) : 0,
      invoiced_value: p.invoiced_value,
      end_date: p.end_date,
      pending_em_count: p.pending_em_count,
      pending_weekly_count: p.pending_weekly_count,
      revision_count: p.revision_count,
      // Revisjon (UEs egen oppgave) skal sortere over rene venter-saker.
      attention_rank: p.revision_count * 1000 + p.pending_em_count * 10 + p.pending_weekly_count,
      line_count: p.budget_lines.length,
      contact: pm,
      contact_label: pm ? `${pm.full_name}${extra}` : '–',
      start_date: p.start_date,
    }
  }), [projects])

  // Statusteller-chips: tell på tvers av søket (ikke statusfilteret) slik at hvert
  // tall viser hvor mange prosjekter den statusen har akkurat nå.
  const statusCounts = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matchesSearch = (r: ProjectRow) => {
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        r.project_number.toLowerCase().includes(q) ||
        r.customer.toLowerCase().includes(q) ||
        r.county?.toLowerCase().includes(q)
      )
    }
    const inSearch = rows.filter(matchesSearch)
    return {
      active: inSearch.filter((r) => r.status === 'active').length,
      completed: inSearch.filter((r) => r.status === 'completed').length,
      archived: inSearch.filter((r) => r.status === 'archived').length,
      all: inSearch.length,
    } as Record<StatusFilter, number>
  }, [rows, search])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => statusFilter === 'all' || r.status === statusFilter)
      .filter((r) => {
        if (!q) return true
        return (
          r.name.toLowerCase().includes(q) ||
          r.project_number.toLowerCase().includes(q) ||
          r.customer.toLowerCase().includes(q) ||
          r.county?.toLowerCase().includes(q)
        )
      })
  }, [rows, search, statusFilter])

  const columns: Column<ProjectRow>[] = [
    { key: 'name', label: 'Prosjektnavn', sortable: true },
    { key: 'project_number', label: 'Nummer', sortable: true },
    { key: 'customer', label: 'Kunde', sortable: true },
    { key: 'county', label: 'Fylke', sortable: true },
    {
      // S.7: entydig etikett — dette er UE-ens eget kostbudsjett, ikke
      // salgsverdi mot kunde. «Mitt budsjett» fjerner tvetydigheten i «Ordreverdi».
      key: 'budget_value',
      label: 'Mitt budsjett',
      sortable: true,
      getValue: (row) => row.budget_value,
      render: (row) => (
        <span className={row.budget_value > 0 ? 'font-medium text-[var(--color-text-primary)] tabular-nums' : 'text-[var(--color-text-muted)]'}>
          {row.budget_value > 0 ? fmt(row.budget_value) : '–'}
        </span>
      ),
    },
    {
      key: 'approved_value',
      label: 'Godkjent hittil',
      sortable: true,
      getValue: (row) => row.approved_value,
      render: (row) => (
        <span className={row.approved_value > 0 ? 'font-medium text-green-600 tabular-nums' : 'text-[var(--color-text-muted)]'}>
          {row.approved_value > 0 ? fmt(row.approved_value) : '–'}
        </span>
      ),
    },
    {
      // 3.5 + S.7: «Gjenstår budsjett» = Mitt budsjett − Godkjent hittil. Rød når
      // negativ (godkjent/EM over opprinnelig ordre). Tittel + tooltip er ærlige
      // om at budsjettet er opprinnelig ordre uten godkjente EM.
      key: 'remaining_value',
      label: (
        <span title="Mitt budsjett − Godkjent hittil. Mitt budsjett er opprinnelig ordre uten godkjente EM, så tallet kan bli negativt når godkjent arbeid (inkl. EM) overstiger opprinnelig ordre.">
          Gjenstår budsjett
        </span>
      ),
      sortable: true,
      getValue: (row) => row.remaining_value,
      render: (row) => {
        if (row.budget_value === 0) return <span className="text-[var(--color-text-muted)]">–</span>
        const negative = row.remaining_value < 0
        return (
          <span className={`font-medium tabular-nums ${negative ? 'text-red-600' : 'text-[var(--color-text-primary)]'}`}>
            {fmt(row.remaining_value)}
          </span>
        )
      },
    },
    {
      // 3.6: fremdrift som bar (approved_value/budget_value), paritet med dashbordet.
      key: 'progress_pct',
      label: 'Fremdrift',
      sortable: true,
      getValue: (row) => row.progress_pct,
      tdClassName: 'min-w-[120px]',
      render: (row) => {
        if (row.budget_value === 0) return <span className="text-[var(--color-text-muted)]">–</span>
        const pct = Math.max(0, Math.min(100, row.progress_pct))
        return (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-medium text-[var(--color-text-secondary)] tabular-nums flex-none w-9 text-right">
              {row.progress_pct}%
            </span>
          </div>
        )
      },
    },
    {
      // 3.6: frist-kolonne via daysUntil med overdue/soon-farging (samme terskler
      // som dashbordet: forfalt = rød, ≤14 dager = oransje).
      key: 'end_date',
      label: 'Frist',
      sortable: true,
      getValue: (row) => row.end_date ?? '9999-12-31',
      render: (row) => {
        if (!row.end_date) return <span className="text-[var(--color-text-muted)]">pågående</span>
        const days = daysUntil(row.end_date)
        const overdue = days !== null && days < 0
        const soon = days !== null && days >= 0 && days <= 14
        return (
          <span className={`inline-flex flex-col leading-tight text-xs tabular-nums ${overdue ? 'text-red-600 font-semibold' : soon ? 'text-amber-600 font-medium' : 'text-[var(--color-text-secondary)]'}`}>
            <span>{fmtDate(row.end_date)}</span>
            {days !== null && (
              <span className="text-[10px]">
                {overdue ? `${Math.abs(days)}d forsinket` : days === 0 ? 'i dag' : `${days}d igjen`}
              </span>
            )}
          </span>
        )
      },
    },
    {
      // 3.7: saks-pills — venter-saker nøytrale, revisjon oransje (UEs egen oppgave).
      // Mønster fra components/admin/ProjectsOverviewTable.tsx:181-202.
      key: 'attention_rank',
      label: 'Saker',
      sortable: true,
      getValue: (row) => row.attention_rank,
      render: (row) => {
        const hasAny = row.revision_count + row.pending_em_count + row.pending_weekly_count > 0
        if (!hasAny) return <span className="text-sm text-[var(--color-text-muted)]">–</span>
        return (
          <span className="flex items-center gap-1.5 flex-wrap">
            {row.revision_count > 0 && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-100 text-orange-700 text-[11px] font-semibold"
                title={`${row.revision_count} endringsmelding(er) trenger din revisjon`}
              >
                <AlertTriangle size={13} />{row.revision_count} revisjon
              </span>
            )}
            {row.pending_em_count > 0 && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-[var(--color-text-muted)] text-[11px] font-medium"
                title={`${row.pending_em_count} endringsmelding(er) venter på prosjektleder`}
              >
                <FileText size={13} />{row.pending_em_count} EM
              </span>
            )}
            {row.pending_weekly_count > 0 && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-[var(--color-text-muted)] text-[11px] font-medium"
                title={`${row.pending_weekly_count} ukesrapport(er) venter på prosjektleder`}
              >
                <ClipboardList size={13} />{row.pending_weekly_count} rapp.
              </span>
            )}
          </span>
        )
      },
    },
    {
      key: 'contact_label',
      label: 'Kontaktperson',
      sortable: true,
      render: (row) => row.contact ? (
        <div className="text-xs leading-tight">
          <div className="text-[var(--color-text-primary)] font-medium">{row.contact.full_name}</div>
          <a
            href={`mailto:${row.contact.email}`}
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline"
          >
            {row.contact.email}
          </a>
        </div>
      ) : <span className="text-[var(--color-text-muted)]">–</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <Badge status={row.status as BadgeStatus} />,
    },
    {
      key: 'action',
      label: '',
      render: (row) => (
        <button
          className="text-xs text-primary hover:underline"
          onClick={(e) => { e.stopPropagation(); router.push(`/subcontractor/projects/${row.id}`) }}
        >
          Åpne →
        </button>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Laster...</div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Prosjekter</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
          {rows.length} totalt · {rows.filter((r) => r.status === 'active').length} aktive
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex flex-col gap-3">
          {/* 3.10: klikkbare statusteller-chips erstatter den skjulte dropdownen
              så UE ser hvor mange prosjekter hver status har. Mønster fra
              components/admin/ProjectsOverviewTable.tsx:88-105. */}
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            {STATUS_CHIPS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`px-2.5 py-1 rounded-full border transition-colors ${
                  statusFilter === key
                    ? 'bg-primary-soft text-primary border-primary-soft'
                    : 'border-border text-[var(--color-text-secondary)] hover:bg-muted'
                }`}
              >
                {label} <span className="text-[var(--color-text-muted)]">{statusCounts[key]}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Søk navn, nummer, kunde, fylke..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
              />
            </div>
            <span className="text-xs text-[var(--color-text-muted)] ml-auto">
              {filtered.length} {filtered.length === 1 ? 'prosjekt' : 'prosjekter'}
            </span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title={search || statusFilter !== 'active'
              ? 'Ingen treff'
              : rows.length > 0 ? 'Ingen aktive prosjekter' : 'Ingen prosjekter tildelt ennå'}
            description={search || statusFilter !== 'active'
              ? 'Juster søket eller statusfilteret.'
              : rows.length > 0
                ? 'Du har ingen aktive prosjekter nå — bytt status-knapp over for å se fullførte eller arkiverte.'
                : 'Du blir lagt til på prosjekter av en administrator.'}
          />
        ) : (
          <SortableTable
            columns={columns}
            data={filtered}
            emptyText="Ingen prosjekter"
            onRowClick={(row) => router.push(`/subcontractor/projects/${row.id}`)}
          />
        )}
      </Card>
    </div>
  )
}
