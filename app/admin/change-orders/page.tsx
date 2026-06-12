import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { ADMIN_ROLES, PROJECT_STAFF_ROLES } from '@/lib/roles'
import { getProjectScope } from '@/lib/api-guard'
import type { ChangeOrder, Project, Subcontractor } from '@/types'
import { fmtNOK as fmt, fmtChangeOrderTitle } from '@/lib/format'
import ChangeOrdersListClient, { type EmRow, type EmStatus } from './ChangeOrdersListClient'

export const dynamic = 'force-dynamic'

export default async function ChangeOrdersPage() {
  const me = await getSession()
  // Project staff incl. byggeleder (oppfølgingsmodus). Kundeverdi rendres og
  // serialiseres KUN for økonomiroller — radene bygges server-side med
  // value=null for andre, så tallene aldri når en byggeleders nettleser.
  if (!me || !PROJECT_STAFF_ROLES.includes(me.role)) redirect('/login')
  const canSeeEconomy = ADMIN_ROLES.includes(me.role)

  const sb = getSupabaseAdmin()
  const [projRes, ordersRes, subsRes] = await Promise.all([
    sb.from('projects').select('*').neq('deleted', true),
    sb.from('change_orders').select('*').neq('status', 'draft'),
    sb.from('subcontractors').select('*'),
  ])

  const projects = (projRes.data ?? []) as Project[]
  const subcontractors = (subsRes.data ?? []) as Subcontractor[]
  let orders = (ordersRes.data ?? []) as ChangeOrder[]

  const scope = await getProjectScope(me)
  if (scope) orders = orders.filter((o) => scope.has(o.project_id))

  const activeProjectIds = new Set(projects.map((p) => p.id))
  orders = orders
    .filter((o) => activeProjectIds.has(o.project_id))
    .sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))

  const projMap = new Map(projects.map((p) => [p.id, p]))
  const subMap = new Map(subcontractors.map((s) => [s.id, s]))

  const pending = orders.filter((o) => o.status === 'pending')
  const approved = orders.filter((o) => o.status === 'approved')
  const rejected = orders.filter((o) => o.status === 'rejected')
  const pendingValue = pending.reduce((s, o) => s + o.total_customer_value, 0)

  // Flate, serialiserbare rader til klientfilteret — uten kundeverdi for
  // ikke-økonomiroller.
  const rows: EmRow[] = orders.map((o) => ({
    id: o.id,
    title: fmtChangeOrderTitle(o.change_order_number, projMap.get(o.project_id)?.name),
    em_type: o.em_type,
    sub_name: subMap.get(o.subcontractor_id)?.company_name ?? '–',
    sub_id: o.subcontractor_id,
    project_id: o.project_id,
    value: canSeeEconomy ? o.total_customer_value : null,
    cost: o.total_cost,
    submitted: o.submitted_at ? o.submitted_at.split('T')[0] : '–',
    status: o.status as EmStatus,
  }))

  // Filtermenyene viser kun prosjekter/UE-er som faktisk har EM-er.
  const emProjectIds = new Set(orders.map((o) => o.project_id))
  const filterProjects = projects
    .filter((p) => emProjectIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
  const emSubIds = new Set(orders.map((o) => o.subcontractor_id))
  const filterSubs = subcontractors
    .filter((s) => emSubIds.has(s.id))
    .map((s) => ({ id: s.id, name: s.company_name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Endringsmeldinger</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            {canSeeEconomy
              ? `${pending.length} venter (${fmt(pendingValue)}) · ${approved.length} godkjent · ${rejected.length} avvist`
              : `${pending.length} venter · ${approved.length} godkjent · ${rejected.length} avvist`}
          </p>
        </div>
      </div>

      <ChangeOrdersListClient rows={rows} projects={filterProjects} subs={filterSubs} showEconomy={canSeeEconomy} />
    </div>
  )
}
