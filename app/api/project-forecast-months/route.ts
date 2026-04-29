import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ProjectForecastMonth } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const forecastId = searchParams.get('forecast_id')
  let months = readJson<ProjectForecastMonth>('project_forecast_months.json')
  if (forecastId) months = months.filter((m) => m.project_forecast_id === forecastId)
  return NextResponse.json(months)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { forecast_id: string; months: Omit<ProjectForecastMonth, 'id' | 'project_forecast_id'>[] }
  const all = readJson<ProjectForecastMonth>('project_forecast_months.json')

  // Replace all months for this forecast (upsert)
  const kept = all.filter((m) => m.project_forecast_id !== body.forecast_id)
  const newMonths: ProjectForecastMonth[] = body.months.map((m) => ({
    id: randomUUID(),
    project_forecast_id: body.forecast_id,
    month: m.month,
    year: m.year,
    expected_revenue: m.expected_revenue ?? 0,
    expected_ue_cost: m.expected_ue_cost ?? 0,
    expected_internal_cost: m.expected_internal_cost ?? 0,
    expected_other_cost: m.expected_other_cost ?? 0,
    risk_amount: m.risk_amount ?? 0,
    comment: m.comment ?? '',
  }))

  writeJson('project_forecast_months.json', [...kept, ...newMonths])
  return NextResponse.json(newMonths, { status: 201 })
}
