'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { ChangeOrder, ActivityEntry } from '@/types'
import type { BadgeStatus } from '@/components/ui/Badge'
import Badge from '@/components/ui/Badge'
import Card from '@/components/ui/Card'
import SortableTable from '@/components/SortableTable'
import type { Column } from '@/components/SortableTable'
import { fmtNOK as fmt, fmtChangeOrderTitle } from '@/lib/format'
import { changeOrderType } from '@/lib/statuses'
import { useMe } from '@/lib/useMe'
import VersionDiffModal from '@/components/admin/VersionDiffModal'

// API legger til has_admin_edits + has_consequence_lines etter UE-strip
// av kundepris-felter — se app/api/subcontractor/change-orders/route.ts.
type UEChangeOrder = Omit<ChangeOrder, 'customer_price_snapshot' | 'total_customer_value' | 'profit'> & {
  has_admin_edits: boolean
  has_consequence_lines: boolean
}

type BudgetLine = {
  id: string
  product_id: string
  product_name: string
  unit: string
  budget_quantity: number
  subcontractor_cost_price_snapshot: number
}

type ProjectWithLines = {
  id: string
  name: string
  project_number: string
  customer: string
  status: string
  budget_lines: BudgetLine[]
}

type EMRow = {
  id: string
  project_id: string
  em_title: string
  em_type: string
  product_name: string
  requested_quantity: number
  unit: string
  total_cost: number
  status: string
  submitted_at: string | null
  attachment_url: string | null
  has_admin_edits: boolean
  has_consequence_lines: boolean
}

export default function SubcontractorChangeOrdersPage() {
  const router = useRouter()
  const { me } = useMe()
  const [projects, setProjects] = useState<ProjectWithLines[]>([])
  const [changeOrders, setChangeOrders] = useState<UEChangeOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  // Versjonsdiff-popup når UE klikker 'Se endringer'-link på en EM med
  // has_admin_edits=true. Henter siste 'edited'-rad fra /api/activity og
  // sender den til VersionDiffModal. Kundepris-felter er allerede strippet
  // rekursivt av /api/activity (stripCustomerKeysDeep) før det lander her.
  const [diffEntry, setDiffEntry] = useState<ActivityEntry | null>(null)
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null)

  async function openLatestEdit(coId: string) {
    setLoadingDiff(coId)
    try {
      const res = await fetch(`/api/activity?entity_id=${coId}&entity_type=change_order`)
      if (!res.ok) return
      const all = (await res.json()) as ActivityEntry[]
      const lastEdited = [...all].reverse().find((e) => e.action === 'edited')
      if (lastEdited) setDiffEntry(lastEdited)
    } finally {
      setLoadingDiff(null)
    }
  }

  const fetchAll = useCallback(async (subId: string) => {
    const [proj, cos] = await Promise.all([
      fetch(`/api/subcontractor/projects?subcontractor_id=${subId}`).then((r) => r.json()) as Promise<ProjectWithLines[]>,
      fetch(`/api/subcontractor/change-orders?subcontractor_id=${subId}`).then((r) => r.json()) as Promise<UEChangeOrder[]>,
    ])
    setProjects(proj)
    setChangeOrders(cos)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!me) return
    if (me.role !== 'sub') { router.replace('/login'); return }
    // View-as preview: super-admin posing as `sub` has no subcontractor_id
    // of their own. Show empty state instead of bouncing.
    if (!me.subcontractor_id) { setLoading(false); return }
    fetchAll(me.subcontractor_id)
  }, [me, router, fetchAll])

  const projectMap = new Map(projects.map((p) => [p.id, p.name]))
  const productNameMap = new Map(
    projects.flatMap((p) => p.budget_lines.map((bl) => [bl.product_id, bl.product_name]))
  )

  const rows: EMRow[] = changeOrders
    .filter((co) => statusFilter === 'all' || co.status === statusFilter)
    .filter((co) => projectFilter === 'all' || co.project_id === projectFilter)
    .map((co) => ({
      id: co.id,
      project_id: co.project_id,
      em_title: fmtChangeOrderTitle(co.change_order_number, projectMap.get(co.project_id)),
      em_type: co.em_type,
      product_name: productNameMap.get(co.product_id) ?? '–',
      requested_quantity: co.requested_quantity,
      unit: co.unit,
      total_cost: co.total_cost,
      status: co.status,
      submitted_at: co.submitted_at,
      attachment_url: co.attachment_url,
      has_admin_edits: co.has_admin_edits,
      has_consequence_lines: co.has_consequence_lines,
    }))

  const columns: Column<EMRow>[] = [
    {
      key: 'em_title',
      label: 'Endringsmelding',
      sortable: true,
      render: (row) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium text-[var(--color-text-primary)]">{row.em_title}</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {row.has_admin_edits && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openLatestEdit(row.id) }}
                disabled={loadingDiff === row.id}
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors disabled:opacity-50"
                title="Prosjektleder har redigert denne EM-en. Klikk for å se hva som er endret."
              >
                Endret av prosjektleder · Se endringer
              </button>
            )}
            {row.has_consequence_lines && (
              <span className="inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">
                Har konsekvens ved avslag
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'em_type',
      label: 'Type',
      sortable: true,
      render: (row) => {
        const t = changeOrderType(row.em_type)
        return <span className={`text-xs px-2 py-0.5 rounded ${t.cls}`}>{t.label}</span>
      },
    },
    { key: 'product_name', label: 'Produkt', sortable: true },
    {
      key: 'requested_quantity',
      label: 'Mengde',
      sortable: true,
      render: (row) => `${row.requested_quantity} ${row.unit}`,
    },
    {
      key: 'total_cost',
      label: 'Kostnad',
      sortable: true,
      getValue: (row) => row.total_cost,
      render: (row) => fmt(row.total_cost),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <Badge status={row.status as BadgeStatus} />,
    },
    {
      key: 'submitted_at',
      label: 'Innsendt',
      sortable: true,
      getValue: (row) => row.submitted_at ?? '',
      render: (row) => (
        <span className="text-[var(--color-text-muted)]">{row.submitted_at?.split('T')[0] ?? '–'}</span>
      ),
    },
    {
      key: 'attachment_url',
      label: 'Vedlegg',
      render: (row) =>
        row.attachment_url ? (
          <a
            href={`/api/change-orders/${row.id}/attachment?redirect=1`}
            target="_blank"
            rel="noreferrer"
            className="text-primary text-xs hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Se vedlegg
          </a>
        ) : (
          <span className="text-[var(--color-text-muted)]">–</span>
        ),
    },
    {
      key: 'action',
      label: '',
      render: (row) => (
        <button
          className="text-xs text-primary hover:underline"
          onClick={(e) => { e.stopPropagation(); router.push(`/subcontractor/projects/${row.project_id}`) }}
        >
          Gå til prosjekt →
        </button>
      ),
    },
  ]

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Laster...</div>
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Endringsmeldinger</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Alle dine endringsmeldinger på tvers av prosjekter
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-[var(--color-text-primary)]">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary"
            >
              <option value="all">Alle</option>
              <option value="draft">Kladd</option>
              <option value="revision_requested">Trenger revisjon</option>
              <option value="pending">Venter</option>
              <option value="approved">Godkjent</option>
              <option value="rejected">Avvist</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-[var(--color-text-primary)]">Prosjekt</label>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary"
            >
              <option value="all">Alle prosjekter</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <span className="text-xs text-[var(--color-text-muted)] ml-auto">
            {rows.length} endringsmelding{rows.length !== 1 ? 'er' : ''}
          </span>
        </div>
        <SortableTable
          columns={columns}
          data={rows}
          emptyText="Ingen endringsmeldinger"
          onRowClick={(row) => router.push(`/subcontractor/projects/${row.project_id}`)}
        />
      </Card>

      {/* Versjonsdiff-popup. /api/activity har allerede strippet
          customer_price_snapshot, total_customer_value og profit
          rekursivt fra metadata — UE ser her kun trygge felter. */}
      <VersionDiffModal entry={diffEntry} onClose={() => setDiffEntry(null)} />
    </div>
  )
}
