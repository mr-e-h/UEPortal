import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { ADMIN_ROLES } from '@/lib/roles'
import { getProjectScope } from '@/lib/api-guard'
import type { ForecastPeriod, ProjectForecast, Project, ProjectInvoice, ProjectBudgetLine } from '@/types'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import { fmtNOK as fmt } from '@/lib/format'
import { forecastPeriodStatus } from '@/lib/statuses'
import CreatePeriodsButton from './CreatePeriodsButton'

export const dynamic = 'force-dynamic'

export default async function ForecastsOverviewPage() {
  const me = await getSession()
  if (!me || !ADMIN_ROLES.includes(me.role)) redirect('/login')

  const year = new Date().getFullYear()
  const sb = getSupabaseAdmin()

  const [periodsRes, projectsRes, forecastsRes, invoicesRes, budgetLinesRes] = await Promise.all([
    sb.from('forecast_periods').select('*').eq('year', year),
    sb.from('projects').select('*').eq('status', 'active').neq('deleted', true),
    sb.from('project_forecasts').select('*'),
    sb.from('project_invoices').select('project_id, amount'),
    sb.from('project_budget_lines').select('project_id, budget_quantity, customer_price_snapshot'),
  ])

  const periods = (periodsRes.data ?? []) as ForecastPeriod[]
  // PM scope: project_manager users only see their own assigned projects, so
  // every aggregate (sums, "missing forecasts", per-period totals) reflects
  // their portfolio only — never another PM's economy. main / company /
  // company-admin pass through (scope is null) and see everything.
  const scope = await getProjectScope(me)
  let projects = (projectsRes.data ?? []) as Project[]
  if (scope) projects = projects.filter((p) => scope.has(p.id))
  const activeProjectIds = new Set(projects.map((p) => p.id))
  const allForecasts = ((forecastsRes.data ?? []) as ProjectForecast[])
    .filter((f) => activeProjectIds.has(f.project_id))
  const invoices = ((invoicesRes.data ?? []) as Pick<ProjectInvoice, 'project_id' | 'amount'>[])
    .filter((i) => activeProjectIds.has(i.project_id))
  const budgetLines = ((budgetLinesRes.data ?? []) as Pick<ProjectBudgetLine, 'project_id' | 'budget_quantity' | 'customer_price_snapshot'>[])
    .filter((bl) => activeProjectIds.has(bl.project_id))

  const totalInvoiced = invoices.reduce((s, i) => s + i.amount, 0)
  const totalBudget = budgetLines.reduce((s, bl) => s + bl.budget_quantity * bl.customer_price_snapshot, 0)

  // No periods initialized yet for this year — show explicit create button.
  // Previously this was lazy auto-create on GET (race + side-effect bug);
  // now admin sees what they're doing and clicks once per year.
  if (periods.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Prognoser {year}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            {projects.length} aktive prosjekter
          </p>
        </div>
        <Card>
          <EmptyState
            title={`Ingen prognoseperioder for ${year} ennå`}
            description="Periodene P1-P4 må opprettes før prognoser kan registreres."
            action={<CreatePeriodsButton year={year} />}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Prognoser {year}</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
          {projects.length} aktive prosjekter · Totalt budsjett {fmt(totalBudget)} · Fakturert {fmt(totalInvoiced)}
        </p>
      </div>

      {/* Period cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {['P1', 'P2', 'P3', 'P4'].map((pName) => {
          const period = periods.find((p) => p.name === pName)
          if (!period) return null
          const forecasts = allForecasts.filter((f) => f.forecast_period_id === period.id)
          const submitted = forecasts.filter((f) => f.status === 'submitted').length
          const approved = forecasts.filter((f) => f.status === 'approved' || f.status === 'locked').length
          const missing = projects.length - forecasts.filter((f) => f.status !== 'not_started').length
          const totalRevenue = forecasts.reduce((s, f) => s + f.expected_revenue, 0)

          return (
            <Link key={pName} href={`/admin/forecasts/${pName.toLowerCase()}`}>
              <Card className={`p-5 hover:shadow-md transition-all cursor-pointer border-l-4 ${
                period.locked ? 'border-l-gray-400' : submitted > 0 ? 'border-l-primary' : 'border-l-border'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-base font-bold text-[var(--color-text-primary)]">{pName}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    period.locked ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'
                  }`}>
                    {forecastPeriodStatus(period.status).label}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mb-3">Jan – Des {period.year}</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">Prognosert omsetning</span>
                    <span className="font-medium text-[var(--color-text-primary)]">{fmt(totalRevenue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">Sendt inn</span>
                    <span className="font-medium">{submitted} av {projects.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">Godkjent</span>
                    <span className="font-medium text-green-600">{approved}</span>
                  </div>
                  {missing > 0 && (
                    <div className="flex justify-between">
                      <span className="text-amber-600">Mangler prognose</span>
                      <span className="font-medium text-amber-600">{missing}</span>
                    </div>
                  )}
                </div>
                {period.locked && (
                  <p className="text-xs text-[var(--color-text-muted)] mt-3 border-t border-border pt-2">
                    Låst av {period.locked_by} · {period.locked_at?.split('T')[0]}
                  </p>
                )}
              </Card>
            </Link>
          )
        })}
      </div>

      {/* All-period summary */}
      <Card>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Totaloversikt {year}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Periode', 'Prognosert omsetning', 'Progn. UE-kostnad', 'Progn. intern', 'Risiko', 'Forv. fortjeneste', 'Status'].map((h) => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {['P1', 'P2', 'P3', 'P4'].map((pName) => {
                const period = periods.find((p) => p.name === pName)
                if (!period) return null
                const forecasts = allForecasts.filter((f) => f.forecast_period_id === period.id)
                const revenue = forecasts.reduce((s, f) => s + f.expected_revenue, 0)
                const ueCost = forecasts.reduce((s, f) => s + f.expected_ue_cost, 0)
                const internal = forecasts.reduce((s, f) => s + f.expected_internal_cost, 0)
                const risk = forecasts.reduce((s, f) => s + f.risk_amount, 0)
                const profit = forecasts.reduce((s, f) => s + f.expected_profit, 0)
                return (
                  <tr key={pName} className="border-b border-border last:border-0 hover:bg-muted transition-colors">
                    <td className="px-6 py-3">
                      <Link href={`/admin/forecasts/${pName.toLowerCase()}`} className="font-semibold text-primary hover:underline">
                        {pName}
                      </Link>
                      <span className="ml-2 text-xs text-[var(--color-text-muted)]">Jan – Des {period.year}</span>
                    </td>
                    <td className="px-6 py-3 font-medium">{fmt(revenue)}</td>
                    <td className="px-6 py-3 text-[var(--color-text-secondary)]">{fmt(ueCost)}</td>
                    <td className="px-6 py-3 text-[var(--color-text-secondary)]">{fmt(internal)}</td>
                    <td className="px-6 py-3 text-amber-600">{risk > 0 ? fmt(risk) : '–'}</td>
                    <td className={`px-6 py-3 font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(profit)}</td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        period.locked ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'
                      }`}>
                        {forecastPeriodStatus(period.status).label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {(() => {
        const forecastedIds = new Set(allForecasts.map((f) => f.project_id))
        const unforcasted = projects.filter((p) => !forecastedIds.has(p.id))
        if (unforcasted.length === 0) return null
        return (
          <Card>
            <div className="px-6 py-4 border-b border-border flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Prosjekter uten prognose</h2>
              <span className="bg-amber-100 text-amber-700 text-xs font-medium px-1.5 py-0.5 rounded-full">{unforcasted.length}</span>
            </div>
            <div className="divide-y divide-border">
              {unforcasted.map((p) => (
                <div key={p.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">{p.name}</span>
                    <span className="ml-2 text-xs text-[var(--color-text-muted)]">{p.project_number} · {p.customer}</span>
                  </div>
                  <Link href={`/admin/forecasts/p1`} className="text-xs text-primary hover:underline">
                    Legg inn prognose →
                  </Link>
                </div>
              ))}
            </div>
          </Card>
        )
      })()}
    </div>
  )
}
