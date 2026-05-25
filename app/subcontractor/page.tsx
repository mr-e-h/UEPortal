'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Wallet, Clock, FileText, CheckCircle2, Send, Plus } from 'lucide-react'
import ProjectPickerModal from '@/components/subcontractor/ProjectPickerModal'
import type { ChangeOrder, GanttMilestone } from '@/types'
import type { BadgeStatus } from '@/components/ui/Badge'
import Badge from '@/components/ui/Badge'
import Card from '@/components/ui/Card'
import StatusPill from '@/components/ui/StatusPill'
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
}

type UEChangeOrder = Omit<ChangeOrder, 'customer_price_snapshot' | 'total_customer_value' | 'profit'>

interface PickerProjectLite {
  id: string
  name: string
  project_number: string
  pending_em_count: number
  pending_weekly_count: number
}

interface DashboardPayload {
  kpi: {
    ordreverdi: number
    fakturert: number
    fakturerbart: number
    gjenstaaende: number
  }
  pendingChangeOrders: Array<{
    id: string
    project_id: string
    project_name: string
    project_number: string
    product_name: string
    quantity: number
    unit: string
    total_cost: number
    submitted_at: string | null
  }>
  pendingWeeklyReports: Array<{
    id: string
    project_id: string
    project_name: string
    project_number: string
    year: number
    week_number: number
    submission_number: number
    line_count: number
    total_cost: number
    submitted_at: string | null
  }>
  projects: PickerProjectLite[]
}

const EMPTY_DASHBOARD: DashboardPayload = {
  kpi: { ordreverdi: 0, fakturert: 0, fakturerbart: 0, gjenstaaende: 0 },
  pendingChangeOrders: [],
  pendingWeeklyReports: [],
  projects: [],
}

type ProjectRow = {
  id: string
  name: string
  project_number: string
  customer: string
  status: string
  budget_value: number
  approved_em_value: number
  line_count: number
  contact: { full_name: string; email: string } | null
  contact_label: string
  pending_em_count: number
  pending_weekly_count: number
  pending_total: number
}

export default function SubcontractorPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectWithLines[]>([])
  const [changeOrders, setChangeOrders] = useState<UEChangeOrder[]>([])
  const [milestones, setMilestones] = useState<(GanttMilestone & { project_name?: string })[]>([])
  const [dashboard, setDashboard] = useState<DashboardPayload>(EMPTY_DASHBOARD)
  const [loading, setLoading] = useState(true)
  const [picker, setPicker] = useState<'new-em' | 'weekly-report' | null>(null)
  const { me } = useMe()
  const userName = me?.full_name ?? ''

  // Safe-fetch helper: anything that 4xx/5xx's becomes [] instead of crashing
  // downstream array methods. An error UI was an option; for the dashboard a
  // graceful empty state is friendlier than a red banner blocking everything.
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
    const [proj, cos, ms, dashRes] = await Promise.all([
      safeJsonArray<ProjectWithLines>(`/api/subcontractor/projects?subcontractor_id=${subId}`),
      safeJsonArray<UEChangeOrder>(`/api/subcontractor/change-orders?subcontractor_id=${subId}`),
      safeJsonArray<GanttMilestone>(`/api/milestones?subcontractor_id=${subId}`),
      fetch(`/api/subcontractor/dashboard?subcontractor_id=${subId}`)
        .then((r) => r.ok ? r.json() as Promise<DashboardPayload> : EMPTY_DASHBOARD)
        .catch(() => EMPTY_DASHBOARD),
    ])
    setProjects(proj)
    setChangeOrders(cos)
    setDashboard(dashRes)
    const projectMap = new Map(proj.map((p) => [p.id, p.name]))
    setMilestones(ms.map((m) => ({ ...m, project_name: projectMap.get(m.project_id) })))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!me) return
    if (me.role !== 'sub') { router.replace('/login'); return }
    // View-as preview: super-admin posing as `sub` has no subcontractor_id
    // of their own. Don't bounce — just show empty state so they can see
    // what a freshly-onboarded UE with no projects yet would experience.
    if (!me.subcontractor_id) { setLoading(false); return }
    fetchAll(me.subcontractor_id)
  }, [me, router, fetchAll])

  // Per-project approved EM value map — feeds the projects table column.
  // Other top-level KPIs now come from /api/subcontractor/dashboard.
  const approvedEMByProject = changeOrders
    .filter((co) => co.status === 'approved')
    .reduce<Record<string, number>>((acc, co) => {
      acc[co.project_id] = (acc[co.project_id] ?? 0) + co.total_cost
      return acc
    }, {})

  // Index dashboard.projects by id so we can look up pending counts per row.
  const pendingByProject = new Map(dashboard.projects.map((p) => [p.id, p]))

  const projectRows: ProjectRow[] = projects.map((p) => {
    const pm = p.project_managers?.[0] ?? null
    const extra = p.project_managers && p.project_managers.length > 1 ? ` (+${p.project_managers.length - 1})` : ''
    const pending = pendingByProject.get(p.id)
    const emCount = pending?.pending_em_count ?? 0
    const wrCount = pending?.pending_weekly_count ?? 0
    return {
      id: p.id,
      name: p.name,
      project_number: p.project_number,
      customer: p.customer,
      status: p.status,
      budget_value: p.budget_lines.reduce((s, bl) => s + bl.budget_quantity * bl.subcontractor_cost_price_snapshot, 0),
      approved_em_value: approvedEMByProject[p.id] ?? 0,
      line_count: p.budget_lines.length,
      contact: pm,
      contact_label: pm ? `${pm.full_name}${extra}` : '–',
      pending_em_count: emCount,
      pending_weekly_count: wrCount,
      pending_total: emCount + wrCount,
    }
  })

  const columns: Column<ProjectRow>[] = [
    { key: 'name', label: 'Prosjektnavn', sortable: true },
    { key: 'project_number', label: 'Nummer', sortable: true },
    { key: 'customer', label: 'Kunde', sortable: true },
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
      key: 'approved_em_value',
      label: 'Godkjente EM',
      sortable: true,
      getValue: (row) => row.approved_em_value,
      render: (row) => (
        <span className={row.approved_em_value > 0 ? 'font-medium text-green-600' : 'text-[var(--color-text-muted)]'}>
          {row.approved_em_value > 0 ? fmt(row.approved_em_value) : '–'}
        </span>
      ),
    },
    {
      key: 'pending_total',
      label: 'Ubehandlet',
      sortable: true,
      getValue: (row) => row.pending_total,
      render: (row) => row.pending_total > 0 ? (
        <div className="flex items-center gap-1">
          {row.pending_em_count > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium" title={`${row.pending_em_count} ventende EM`}>
              <FileText size={9} /> {row.pending_em_count}
            </span>
          )}
          {row.pending_weekly_count > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium" title={`${row.pending_weekly_count} ventende ukerapport`}>
              <Clock size={9} /> {row.pending_weekly_count}
            </span>
          )}
        </div>
      ) : <span className="text-[var(--color-text-muted)]">–</span>,
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

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Laster...</div>
  )

  const today = new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="p-6 space-y-6">
      {/* Greeting + primary quick actions */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-[var(--color-text-muted)] capitalize">{today}</p>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)] mt-0.5">
            {userName ? `Hei, ${userName.split(' ')[0]}` : 'Oversikt'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPicker('weekly-report')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors shadow-sm"
          >
            <Send size={14} /> Send ukesrapport
          </button>
          <button
            type="button"
            onClick={() => setPicker('new-em')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-card border border-border text-[var(--color-text-primary)] rounded-lg hover:bg-muted transition-colors"
          >
            <Plus size={14} /> Endringsmelding
          </button>
        </div>
      </div>

      {/* KPI cards — sub-focused economy snapshot */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            icon: Wallet,
            label: 'Total ordreverdi',
            value: fmt(dashboard.kpi.ordreverdi),
            sub: 'Budsjettert kostnad for alle linjer',
            color: 'text-indigo-600 bg-indigo-50',
          },
          {
            icon: Clock,
            label: 'Gjenstående ordreverdi',
            value: fmt(dashboard.kpi.gjenstaaende),
            sub: 'Ordreverdi minus fakturert',
            color: 'text-amber-600 bg-amber-50',
          },
          {
            icon: FileText,
            label: 'Fakturert',
            value: fmt(dashboard.kpi.fakturert),
            sub: 'Sum av dine UE-fakturaer',
            color: 'text-blue-600 bg-blue-50',
          },
          {
            icon: CheckCircle2,
            label: 'Fakturerbart nå',
            value: fmt(dashboard.kpi.fakturerbart),
            sub: 'Godkjent arbeid ikke fakturert ennå',
            color: 'text-green-600 bg-green-50',
          },
        ].map(({ icon: Icon, label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl border border-border p-4 flex items-start gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-none ${color}`}>
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-bold text-[var(--color-text-primary)] leading-none truncate">{value}</p>
              <p className="text-xs font-medium text-[var(--color-text-primary)] mt-1 leading-tight">{label}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Pending approvals — change orders + weekly reports awaiting admin review */}
      {(dashboard.pendingChangeOrders.length > 0 || dashboard.pendingWeeklyReports.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Endringsmeldinger til godkjenning</h2>
              {dashboard.pendingChangeOrders.length > 0 && (
                <span className="bg-amber-100 text-amber-700 text-xs font-medium px-1.5 py-0.5 rounded-full">
                  {dashboard.pendingChangeOrders.length}
                </span>
              )}
            </div>
            {dashboard.pendingChangeOrders.length === 0 ? (
              <EmptyState title="Ingen ventende EM" description="Alle dine endringsmeldinger er behandlet." />
            ) : (
              <ul className="divide-y divide-border">
                {dashboard.pendingChangeOrders.map((co) => (
                  <li key={co.id}>
                    <Link
                      href={`/subcontractor/projects/${co.project_id}`}
                      className="block px-6 py-3 hover:bg-muted transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {co.product_name}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                            {co.project_name} · {co.quantity} {co.unit}
                          </p>
                        </div>
                        <div className="text-right flex-none">
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{fmt(co.total_cost)}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {co.submitted_at ? new Date(co.submitted_at).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' }) : '–'}
                          </p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Ukesrapporter til godkjenning</h2>
              {dashboard.pendingWeeklyReports.length > 0 && (
                <span className="bg-amber-100 text-amber-700 text-xs font-medium px-1.5 py-0.5 rounded-full">
                  {dashboard.pendingWeeklyReports.length}
                </span>
              )}
            </div>
            {dashboard.pendingWeeklyReports.length === 0 ? (
              <EmptyState title="Ingen ventende ukesrapporter" description="Alle innsendte ukesrapporter er behandlet." />
            ) : (
              <ul className="divide-y divide-border">
                {dashboard.pendingWeeklyReports.map((wr) => (
                  <li key={wr.id}>
                    <Link
                      href={`/subcontractor/projects/${wr.project_id}`}
                      className="block px-6 py-3 hover:bg-muted transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            Uke {wr.week_number} {wr.year}
                            {wr.submission_number > 1 && <span className="text-[var(--color-text-muted)]"> · innsending #{wr.submission_number}</span>}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                            {wr.project_name} · {wr.line_count} {wr.line_count === 1 ? 'linje' : 'linjer'}
                          </p>
                        </div>
                        <div className="text-right flex-none">
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{fmt(wr.total_cost)}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {wr.submitted_at ? new Date(wr.submitted_at).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' }) : '–'}
                          </p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* Projects table */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Mine prosjekter</h2>
        </div>
        {projects.length === 0 ? (
          <EmptyState
            title="Ingen prosjekter tildelt ennå"
            description="Du blir lagt til på prosjekter av en administrator."
          />
        ) : (
          <SortableTable
            columns={columns}
            data={projectRows}
            emptyText="Ingen prosjekter"
            onRowClick={(row) => router.push(`/subcontractor/projects/${row.id}`)}
          />
        )}
      </Card>

      {/* Milestones */}
      {milestones.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Mine milepæler</h2>
          </div>
          <div className="divide-y divide-border">
            {milestones
              .sort((a, b) => a.start_date.localeCompare(b.start_date))
              .map((m) => {
                const todayStr = new Date().toISOString().split('T')[0]
                const isPast = m.end_date < todayStr
                const isActive = m.start_date <= todayStr && m.end_date >= todayStr
                const daysLeft = Math.round(
                  (new Date(m.end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
                )
                return (
                  <div key={m.id} className="px-6 py-3 flex items-center gap-4">
                    <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ backgroundColor: m.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">{m.title}</div>
                      {m.project_name && (
                        <div className="text-xs text-[var(--color-text-muted)]">{m.project_name}</div>
                      )}
                    </div>
                    <div className="text-right flex-none space-y-0.5">
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        {new Date(m.start_date).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' })}
                        {m.start_date !== m.end_date &&
                          ` – ${new Date(m.end_date).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' })}`}
                      </div>
                      {isActive && daysLeft > 0 && (
                        <div className="text-[10px] text-green-600">{daysLeft}d igjen</div>
                      )}
                    </div>
                    <StatusPill tone={isActive ? 'green' : isPast ? 'gray' : 'blue'}>
                      {isActive ? 'Pågår' : isPast ? 'Fullført' : 'Kommende'}
                    </StatusPill>
                  </div>
                )
              })}
          </div>
        </Card>
      )}

      {picker && (
        <ProjectPickerModal
          projects={dashboard.projects}
          action={picker}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
