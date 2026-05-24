import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { ProjectForecastMonth } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const forecastId = new URL(request.url).searchParams.get('forecast_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('project_forecast_months').select('*')
  if (forecastId) query.eq('project_forecast_id', forecastId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as ProjectForecastMonth[])
}

/**
 * Replace-all upsert for a single forecast: scoped delete + insert means
 * two admins editing different forecasts never collide. Same forecast +
 * concurrent saves still last-write-wins (acceptable — single editor at
 * a time in the UI).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    forecast_id: string
    months: Omit<ProjectForecastMonth, 'id' | 'project_forecast_id'>[]
  }
  if (!body.forecast_id) {
    return NextResponse.json({ error: 'forecast_id mangler' }, { status: 400 })
  }

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

  const sb = getSupabaseAdmin()
  const { error: delErr } = await sb
    .from('project_forecast_months')
    .delete()
    .eq('project_forecast_id', body.forecast_id)
  if (delErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  if (newMonths.length > 0) {
    const { error: insErr } = await sb.from('project_forecast_months').insert(newMonths)
    if (insErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  }

  return NextResponse.json(newMonths, { status: 201 })
}
