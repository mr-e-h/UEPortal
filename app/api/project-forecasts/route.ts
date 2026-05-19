import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson, getDeletedProjectIds } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ProjectForecast, ProjectForecastMonth } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const periodId = searchParams.get('period_id')
  const projectId = searchParams.get('project_id')
  const withMonths = searchParams.get('with_months') === 'true'

  const deletedProjectIds = await getDeletedProjectIds()
  let forecasts = (await readJson<ProjectForecast>('project_forecasts.json')).filter((f) => !deletedProjectIds.has(f.project_id))
  if (periodId) forecasts = forecasts.filter((f) => f.forecast_period_id === periodId)
  if (projectId) forecasts = forecasts.filter((f) => f.project_id === projectId)

  if (withMonths) {
    const allMonths = await readJson<ProjectForecastMonth>('project_forecast_months.json')
    return NextResponse.json(
      forecasts.map((f) => ({ ...f, months: allMonths.filter((m) => m.project_forecast_id === f.id) }))
    )
  }

  return NextResponse.json(forecasts)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Omit<ProjectForecast, 'id' | 'created_at' | 'updated_at'>
  const forecasts = await readJson<ProjectForecast>('project_forecasts.json')
  const now = new Date().toISOString()
  const newForecast: ProjectForecast = {
    id: randomUUID(),
    forecast_period_id: body.forecast_period_id,
    project_id: body.project_id,
    project_manager_id: body.project_manager_id ?? null,
    total_sales_value_snapshot: body.total_sales_value_snapshot ?? 0,
    already_invoiced_snapshot: body.already_invoiced_snapshot ?? 0,
    remaining_invoice_value_snapshot: body.remaining_invoice_value_snapshot ?? 0,
    expected_revenue: body.expected_revenue ?? 0,
    expected_ue_cost: body.expected_ue_cost ?? 0,
    expected_internal_cost: body.expected_internal_cost ?? 0,
    expected_other_cost: body.expected_other_cost ?? 0,
    risk_amount: body.risk_amount ?? 0,
    expected_profit: body.expected_profit ?? 0,
    comment: body.comment ?? '',
    status: body.status ?? 'draft',
    submitted_at: body.submitted_at ?? null,
    approved_at: body.approved_at ?? null,
    approved_by: body.approved_by ?? null,
    returned_comment: body.returned_comment ?? null,
    created_at: now,
    updated_at: now,
  }
  await writeJson('project_forecasts.json', [...forecasts, newForecast])
  return NextResponse.json(newForecast, { status: 201 })
}
