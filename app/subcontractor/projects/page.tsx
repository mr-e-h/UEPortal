'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import type { BadgeStatus } from '@/components/ui/Badge'
import Badge from '@/components/ui/Badge'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import SortableTable from '@/components/SortableTable'
import type { Column } from '@/components/SortableTable'
import { fmtNOK as fmt } from '@/lib/format'
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
  /** Sum of approved work cost (weekly-report lines + approved EMs). */
  approved_value: number
  /** Sum of ue_invoices.amount tagged to this project. */
  invoiced_value: number
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
  invoiced_value: number
  line_count: number
  contact: { full_name: string; email: string } | null
  contact_label: string
  start_date: string
  end_date: string | null
}

type StatusFilter = 'all' | 'active' | 'completed' | 'archived'

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
    return {
      id: p.id,
      name: p.name,
      project_number: p.project_number,
      customer: p.customer,
      county: p.county,
      status: p.status,
      budget_value: p.budget_lines.reduce((s, bl) => s + bl.budget_quantity * bl.subcontractor_cost_price_snapshot, 0),
      approved_value: p.approved_value,
      invoiced_value: p.invoiced_value,
      line_count: p.budget_lines.length,
      contact: pm,
      contact_label: pm ? `${pm.full_name}${extra}` : '–',
      start_date: p.start_date,
      end_date: p.end_date,
    }
  }), [projects])

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
      key: 'budget_value',
      label: 'Ordreverdi',
      sortable: true,
      getValue: (row) => row.budget_value,
      render: (row) => (
        <span className={row.budget_value > 0 ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}>
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
        <span className={row.approved_value > 0 ? 'font-medium text-green-600' : 'text-[var(--color-text-muted)]'}>
          {row.approved_value > 0 ? fmt(row.approved_value) : '–'}
        </span>
      ),
    },
    {
      key: 'invoiced_value',
      label: 'Fakturert totalt',
      sortable: true,
      getValue: (row) => row.invoiced_value,
      render: (row) => (
        <span className={row.invoiced_value > 0 ? 'font-medium text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}>
          {row.invoiced_value > 0 ? fmt(row.invoiced_value) : '–'}
        </span>
      ),
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
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
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
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
          >
            <option value="active">Aktive</option>
            <option value="completed">Fullført</option>
            <option value="archived">Arkivert</option>
            <option value="all">Alle</option>
          </select>
          <span className="text-xs text-[var(--color-text-muted)] ml-auto">
            {filtered.length} {filtered.length === 1 ? 'prosjekt' : 'prosjekter'}
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title={search || statusFilter !== 'active' ? 'Ingen treff' : 'Ingen prosjekter tildelt ennå'}
            description={search || statusFilter !== 'active'
              ? 'Juster søket eller statusfilteret.'
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
