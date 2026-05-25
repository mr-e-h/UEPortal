'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, TrendingUp, Clock, Layers, DollarSign, CheckCircle } from 'lucide-react'
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
}

export default function SubcontractorPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectWithLines[]>([])
  const [changeOrders, setChangeOrders] = useState<UEChangeOrder[]>([])
  const [milestones, setMilestones] = useState<(GanttMilestone & { project_name?: string })[]>([])
  const [loading, setLoading] = useState(true)
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
    const [proj, cos, ms] = await Promise.all([
      safeJsonArray<ProjectWithLines>(`/api/subcontractor/projects?subcontractor_id=${subId}`),
      safeJsonArray<UEChangeOrder>(`/api/subcontractor/change-orders?subcontractor_id=${subId}`),
      safeJsonArray<GanttMilestone>(`/api/milestones?subcontractor_id=${subId}`),
    ])
    setProjects(proj)
    setChangeOrders(cos)
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

  const thisYear = new Date().getFullYear()
  const activeProjects = projects.filter((p) => p.status === 'active')
  const pendingEM = changeOrders.filter((co) => co.status === 'pending').length
  const approvedEMThisYear = changeOrders.filter(
    (co) => co.status === 'approved' && (co.reviewed_at ?? co.submitted_at)?.startsWith(String(thisYear))
  ).length

  // Financial totals
  const totalBudgetValue = projects.reduce(
    (s, p) => s + p.budget_lines.reduce((bs, bl) => bs + bl.budget_quantity * bl.subcontractor_cost_price_snapshot, 0),
    0
  )
  const totalApprovedEMValue = changeOrders
    .filter((co) => co.status === 'approved')
    .reduce((s, co) => s + co.total_cost, 0)

  // Per-project approved EM value map
  const approvedEMByProject = changeOrders
    .filter((co) => co.status === 'approved')
    .reduce<Record<string, number>>((acc, co) => {
      acc[co.project_id] = (acc[co.project_id] ?? 0) + co.total_cost
      return acc
    }, {})

  const projectRows: ProjectRow[] = projects.map((p) => {
    const pm = p.project_managers?.[0] ?? null
    const extra = p.project_managers && p.project_managers.length > 1 ? ` (+${p.project_managers.length - 1})` : ''
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
      {/* Greeting */}
      <div>
        <p className="text-xs text-[var(--color-text-muted)] capitalize">{today}</p>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)] mt-0.5">
          {userName ? `Hei, ${userName.split(' ')[0]}` : 'Oversikt'}
        </h1>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          {
            icon: Layers,
            label: 'Aktive prosjekter',
            value: activeProjects.length,
            sub: 'Tildelte prosjekter',
            color: 'text-blue-600 bg-blue-50',
            isNumber: true,
          },
          {
            icon: DollarSign,
            label: 'Total ordreverdi',
            value: fmt(totalBudgetValue),
            sub: 'Budsjettert arbeid',
            color: 'text-indigo-600 bg-indigo-50',
            isNumber: false,
          },
          {
            icon: CheckCircle,
            label: 'Godkjente EM',
            value: fmt(totalApprovedEMValue),
            sub: 'Alle prosjekter',
            color: 'text-green-600 bg-green-50',
            isNumber: false,
          },
          {
            icon: Clock,
            label: 'Ventende EM',
            value: pendingEM,
            sub: 'Venter på godkjenning',
            color: 'text-orange-600 bg-orange-50',
            isNumber: true,
          },
          {
            icon: TrendingUp,
            label: `Godkjente EM ${thisYear}`,
            value: approvedEMThisYear,
            sub: 'Hittil i år (antall)',
            color: 'text-purple-600 bg-purple-50',
            isNumber: true,
          },
          {
            icon: CalendarDays,
            label: 'Milepæler',
            value: milestones.length,
            sub: 'Totalt registrert',
            color: 'text-teal-600 bg-teal-50',
            isNumber: true,
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
    </div>
  )
}
