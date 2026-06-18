'use client'

import { useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, AlertTriangle } from 'lucide-react'
import type { ActivityEntry } from '@/types'
import Card from '@/components/ui/Card'
import StatusPill from '@/components/ui/StatusPill'
import SortableTable from '@/components/SortableTable'
import type { Column } from '@/components/SortableTable'
import { fmtNOK as fmt, fmtChangeOrderTitle } from '@/lib/format'
import { changeOrderType, changeOrderPill } from '@/lib/statuses'
import VersionDiffModal from '@/components/admin/VersionDiffModal'
import ProjectPickerModal from '@/components/subcontractor/ProjectPickerModal'
import type { UEChangeOrder } from '@/lib/subcontractor-change-orders'

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
  admin_comment: string | null
  sent_to_customer_at: string | null
}

interface Props {
  initialChangeOrders: UEChangeOrder[]
  initialProjects: ProjectWithLines[]
}

/**
 * Client island for the UE change-orders list. Seeded with server-fetched data
 * via initialData — renders immediately with no blank screen or spinner.
 * All interactive features (filters, version diff modal, project picker) are
 * unchanged from the original page. Refetch-after-action can still call
 * /api/subcontractor/change-orders as before.
 *
 * UE-PRIS-ISOLASJON: initialChangeOrders has already had
 * customer_price_snapshot / total_customer_value / profit stripped by the
 * server loader. This client never sees those fields.
 */
export default function ChangeOrdersClient({ initialChangeOrders, initialProjects }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [projects] = useState<ProjectWithLines[]>(initialProjects)
  const [changeOrders] = useState<UEChangeOrder[]>(initialChangeOrders)
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') ?? 'all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [showPicker, setShowPicker] = useState(false)
  const [diffEntry, setDiffEntry] = useState<ActivityEntry | null>(null)
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null)

  const openLatestEdit = useCallback(async (coId: string) => {
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
  }, [])

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
      admin_comment: co.admin_comment,
      sent_to_customer_at: co.sent_to_customer_at,
    }))

  const revisionCount = changeOrders.filter((co) => co.status === 'revision_requested').length

  const columns: Column<EMRow>[] = [
    {
      key: 'em_title',
      label: 'Endringsmelding',
      sortable: true,
      render: (row) => {
        return (
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
            {row.status === 'revision_requested' && (
              row.admin_comment ? (
                <span className="text-xs text-orange-700">
                  <span className="font-semibold">Trenger revisjon: </span>{row.admin_comment}
                </span>
              ) : (
                <span className="text-xs text-orange-700 font-medium">Klikk for å rette opp</span>
              )
            )}
          </div>
        )
      },
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
      render: (row) => {
        const sentToCustomer = row.status === 'pending' && !!row.sent_to_customer_at
        const p = changeOrderPill(row.status, sentToCustomer)
        return <StatusPill meta={p} />
      },
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
      render: (row) => {
        const editable = row.status === 'draft' || row.status === 'revision_requested'
        return (
          <button
            className="text-xs text-primary hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              router.push(
                editable
                  ? `/subcontractor/change-orders/${row.id}?edit=1`
                  : `/subcontractor/change-orders/${row.id}`,
              )
            }}
          >
            {editable
              ? (row.status === 'revision_requested' ? 'Revider →' : 'Rediger →')
              : 'Se detaljer →'}
          </button>
        )
      },
    },
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Endringsmeldinger</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Alle dine endringsmeldinger på tvers av prosjekter
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          disabled={projects.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={16} strokeWidth={2.5} /> Send endringsmelding
        </button>
      </div>

      {revisionCount > 0 && statusFilter !== 'revision_requested' && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-orange-200 bg-orange-50 text-orange-800">
          <AlertTriangle size={18} className="flex-none text-orange-600" />
          <p className="text-sm flex-1">
            <span className="font-semibold">{revisionCount}</span>{' '}
            endringsmelding{revisionCount !== 1 ? 'er' : ''} trenger revisjon fra deg.
          </p>
          <button
            type="button"
            onClick={() => setStatusFilter('revision_requested')}
            className="flex-none text-sm font-semibold text-orange-800 underline hover:no-underline"
          >
            Vis dem
          </button>
        </div>
      )}

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
          onRowClick={(row) => router.push(`/subcontractor/change-orders/${row.id}`)}
        />
      </Card>

      {/* Versjonsdiff-popup. /api/activity har allerede strippet
          customer_price_snapshot, total_customer_value og profit
          rekursivt fra metadata — UE ser her kun trygge felter. */}
      <VersionDiffModal
        entry={diffEntry}
        productNameLookup={(id) => productNameMap.get(id) ?? id}
        onClose={() => setDiffEntry(null)}
      />

      {showPicker && (
        <ProjectPickerModal
          projects={projects.map((p) => ({ id: p.id, name: p.name, project_number: p.project_number }))}
          action="new-em"
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
