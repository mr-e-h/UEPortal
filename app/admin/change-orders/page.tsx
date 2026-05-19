import { readJson } from '@/lib/data'
import type { ChangeOrder, Project, Subcontractor, Product } from '@/types'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { fmtNOK as fmt } from '@/lib/format'

export default async function ChangeOrdersPage() {
  const activeProjectIds = new Set(
    (await readJson<Project>('projects.json')).filter((p) => !p.deleted).map((p) => p.id)
  )
  const orders = (await readJson<ChangeOrder>('change_orders.json'))
    .filter((o) => o.status !== 'draft' && activeProjectIds.has(o.project_id))
    .sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''))

  const projects = await readJson<Project>('projects.json')
  const subcontractors = await readJson<Subcontractor>('subcontractors.json')
  const products = await readJson<Product>('products.json')

  const projMap = new Map(projects.map((p) => [p.id, p]))
  const subMap = new Map(subcontractors.map((s) => [s.id, s]))
  const prodMap = new Map(products.map((p) => [p.id, p]))

  const pending = orders.filter((o) => o.status === 'pending')
  const approved = orders.filter((o) => o.status === 'approved')
  const rejected = orders.filter((o) => o.status === 'rejected')

  const pendingValue = pending.reduce((s, o) => s + o.total_customer_value, 0)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Endringsmeldinger</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            {pending.length} venter ({fmt(pendingValue)}) · {approved.length} godkjent · {rejected.length} avslått
          </p>
        </div>
      </div>

      {pending.length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Venter godkjenning</h2>
            <span className="bg-primary text-white text-xs font-medium px-1.5 py-0.5 rounded-full">
              {pending.length}
            </span>
          </div>
          <OrderTable orders={pending} projMap={projMap} subMap={subMap} prodMap={prodMap} />
        </Card>
      )}

      <Card>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Alle endringsmeldinger</h2>
        </div>
        <OrderTable orders={orders} projMap={projMap} subMap={subMap} prodMap={prodMap} />
      </Card>
    </div>
  )
}

function OrderTable({
  orders,
  projMap,
  subMap,
  prodMap,
}: {
  orders: ChangeOrder[]
  projMap: Map<string, Project>
  subMap: Map<string, Subcontractor>
  prodMap: Map<string, Product>
}) {
  if (orders.length === 0) {
    return <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Ingen endringsmeldinger</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Prosjekt', 'Underentreprenør', 'Produkt', 'Mengde', 'Kundeverdi', 'Kostnad', 'Innsendt', 'Status', ''].map(
              (h) => (
                <th
                  key={h}
                  className={`px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide ${
                    h === 'Kundeverdi' || h === 'Kostnad' ? 'text-right' : ''
                  }`}
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted transition-colors">
              <td className="px-6 py-3 font-medium text-[var(--color-text-primary)]">
                {projMap.get(o.project_id)?.name ?? '–'}
              </td>
              <td className="px-6 py-3 text-[var(--color-text-secondary)]">
                {subMap.get(o.subcontractor_id)?.company_name ?? '–'}
              </td>
              <td className="px-6 py-3 text-[var(--color-text-secondary)]">
                {prodMap.get(o.product_id)?.name ?? '–'}
              </td>
              <td className="px-6 py-3 text-[var(--color-text-muted)]">
                {o.requested_quantity} {o.unit}
              </td>
              <td className="px-6 py-3 text-right text-[var(--color-text-primary)]">
                {fmt(o.total_customer_value)}
              </td>
              <td className="px-6 py-3 text-right text-[var(--color-text-muted)]">{fmt(o.total_cost)}</td>
              <td className="px-6 py-3 text-[var(--color-text-muted)]">
                {o.submitted_at ? o.submitted_at.split('T')[0] : '–'}
              </td>
              <td className="px-6 py-3">
                <Badge
                  status={o.status === 'approved' ? 'approved' : o.status === 'rejected' ? 'rejected' : 'pending'}
                />
              </td>
              <td className="px-6 py-3 text-right">
                <Link href={`/admin/change-orders/${o.id}`} className="text-xs text-primary hover:underline font-medium">
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
