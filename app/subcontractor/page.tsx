'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, TrendingUp, Clock, Layers } from 'lucide-react'
import type { ChangeOrder, GanttMilestone } from '@/types'
import type { BadgeStatus } from '@/components/ui/Badge'
import Badge from '@/components/ui/Badge'
import Card from '@/components/ui/Card'
import SortableTable from '@/components/SortableTable'
import type { Column } from '@/components/SortableTable'

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
  county: string
  status: string
  budget_lines: BudgetLine[]
}

type UEChangeOrder = Omit<ChangeOrder, 'customer_price_snapshot' | 'total_customer_value' | 'profit'>

type ProjectRow = {
  id: string
  name: string
  project_number: string
  customer: string
  status: string
}

export default function SubcontractorPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectWithLines[]>([])
  const [changeOrders, setChangeOrders] = useState<UEChangeOrder[]>([])
  const [milestones, setMilestones] = useState<(GanttMilestone & { project_name?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState('')

  const fetchAll = useCallback(async (subId: string) => {
    const [proj, cos, ms] = await Promise.all([
      fetch(`/api/subcontractor/projects?subcontractor_id=${subId}`).then((r) => r.json()) as Promise<ProjectWithLines[]>,
      fetch(`/api/subcontractor/change-orders?subcontractor_id=${subId}`).then((r) => r.json()) as Promise<UEChangeOrder[]>,
      fetch(`/api/milestones?subcontractor_id=${subId}`).then((r) => r.json()) as Promise<GanttMilestone[]>,
    ])
    setProjects(proj)
    setChangeOrders(cos)
    const projectMap = new Map((proj as ProjectWithLines[]).map((p) => [p.id, p.name]))
    setMilestones((ms as GanttMilestone[]).map((m) => ({ ...m, project_name: projectMap.get(m.project_id) })))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (localStorage.getItem('user_role') !== 'subcontractor') { router.replace('/login'); return }
    const subId = localStorage.getItem('subcontractor_id')
    if (!subId) { router.replace('/login'); return }
    setUserName(localStorage.getItem('user_name') ?? '')
    fetchAll(subId)
  }, [router, fetchAll])

  const thisYear = new Date().getFullYear()
  const activeProjects = projects.filter((p) => p.status === 'active')
  const pendingEM = changeOrders.filter((co) => co.status === 'pending').length
  const approvedEMThisYear = changeOrders.filter(
    (co) => co.status === 'approved' && co.submitted_at?.startsWith(String(thisYear))
  ).length
  const activeProductLines = activeProjects.reduce((sum, p) => sum + p.budget_lines.length, 0)

  const projectRows: ProjectRow[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    project_number: p.project_number,
    customer: p.customer,
    status: p.status,
  }))

  const columns: Column<ProjectRow>[] = [
    { key: 'name', label: 'Prosjektnavn', sortable: true },
    { key: 'project_number', label: 'Nummer', sortable: true },
    { key: 'customer', label: 'Kunde', sortable: true },
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
          className="text-xs text-[#E30613] hover:underline"
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
      <div>
        <p className="text-xs text-[var(--color-text-muted)] capitalize">{today}</p>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)] mt-0.5">
          {userName ? `Hei, ${userName.split(' ')[0]}` : 'Oversikt'}
        </h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Layers, label: 'Aktive prosjekter', value: activeProjects.length, sub: 'Tildelte prosjekter', color: 'text-blue-600 bg-blue-50' },
          { icon: Clock, label: 'Ventende EM', value: pendingEM, sub: 'Venter på godkjenning', color: 'text-orange-600 bg-orange-50' },
          { icon: TrendingUp, label: `Godkjente EM ${thisYear}`, value: approvedEMThisYear, sub: 'Hittil i år', color: 'text-green-600 bg-green-50' },
          { icon: CalendarDays, label: 'Aktive produktlinjer', value: activeProductLines, sub: 'Pr. aktive prosjekter', color: 'text-purple-600 bg-purple-50' },
        ].map(({ icon: Icon, label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl border border-border p-4 flex items-start gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-none ${color}`}>
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-[var(--color-text-primary)] leading-none">{value}</p>
              <p className="text-xs font-medium text-[var(--color-text-primary)] mt-1 leading-tight">{label}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Prosjekter</h2>
        </div>
        {projects.length === 0 ? (
          <div className="p-6 text-center text-[var(--color-text-muted)] text-sm">Ingen prosjekter tildelt ennå</div>
        ) : (
          <SortableTable
            columns={columns}
            data={projectRows}
            emptyText="Ingen prosjekter"
            onRowClick={(row) => router.push(`/subcontractor/projects/${row.id}`)}
          />
        )}
      </Card>

      {milestones.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Mine milepæler</h2>
          </div>
          <div className="divide-y divide-border">
            {milestones
              .sort((a, b) => a.start_date.localeCompare(b.start_date))
              .map((m) => {
                const today = new Date().toISOString().split('T')[0]
                const isPast = m.end_date < today
                const isActive = m.start_date <= today && m.end_date >= today
                return (
                  <div key={m.id} className="px-6 py-3 flex items-center gap-4">
                    <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ backgroundColor: m.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">{m.title}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{m.project_name}</div>
                    </div>
                    <div className="text-right flex-none">
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        {new Date(m.start_date).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' })}
                        {m.start_date !== m.end_date && ` – ${new Date(m.end_date).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' })}`}
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        isActive ? 'bg-green-100 text-green-700' :
                        isPast ? 'bg-gray-100 text-gray-500' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {isActive ? 'Pågår' : isPast ? 'Fullført' : 'Kommende'}
                      </span>
                    </div>
                  </div>
                )
              })}
          </div>
        </Card>
      )}
    </div>
  )
}
