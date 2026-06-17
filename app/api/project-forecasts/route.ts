import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getDeletedProjectIds } from '@/lib/data'
import { requireAdmin, getProjectScope, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectForecast, ProjectForecastMonth } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const periodId = searchParams.get('period_id')
  const projectId = searchParams.get('project_id')
  const withMonths = searchParams.get('with_months') === 'true'

  const sb = getSupabaseAdmin()
  const query = sb.from('project_forecasts').select('*')
  if (periodId) query.eq('forecast_period_id', periodId)
  if (projectId) query.eq('project_id', projectId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let forecasts = (data ?? []) as ProjectForecast[]

  const deletedProjectIds = await getDeletedProjectIds()
  forecasts = forecasts.filter((f) => !deletedProjectIds.has(f.project_id))

  const scope = await getProjectScope(auth.user)
  if (scope) forecasts = forecasts.filter((f) => scope.has(f.project_id))

  if (withMonths) {
    const ids = forecasts.map((f) => f.id)
    const { data: monthsData } = ids.length > 0
      ? await sb.from('project_forecast_months').select('*').in('project_forecast_id', ids)
      : { data: [] as ProjectForecastMonth[] }
    const months = (monthsData ?? []) as ProjectForecastMonth[]
    const byForecast = new Map<string, ProjectForecastMonth[]>()
    for (const m of months) {
      const arr = byForecast.get(m.project_forecast_id) ?? []
      arr.push(m)
      byForecast.set(m.project_forecast_id, arr)
    }
    return NextResponse.json(forecasts.map((f) => ({ ...f, months: byForecast.get(f.id) ?? [] })))
  }

  return NextResponse.json(forecasts)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Omit<ProjectForecast, 'id' | 'created_at' | 'updated_at'>
  if (!body.project_id || !body.forecast_period_id) {
    return NextResponse.json({ error: 'project_id og forecast_period_id er påkrevd' }, { status: 400 })
  }

  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const now = new Date().toISOString()
  const newForecast: ProjectForecast = {
    id: randomUUID(),
    forecast_period_id: body.forecast_period_id,
    project_id: body.project_id,
    project_manager_id: body.project_manager_id ?? null,
    expected_revenue: body.expected_revenue ?? 0,
    expected_ue_cost: body.expected_ue_cost ?? 0,
    expected_internal_cost: body.expected_internal_cost ?? 0,
    expected_other_cost: body.expected_other_cost ?? 0,
    risk_amount: body.risk_amount ?? 0,
    // Avledet, aldri klient-styrt: inntekt − UE-kost − internkost − annen kost − risiko.
    expected_profit:
      (body.expected_revenue ?? 0) - (body.expected_ue_cost ?? 0) - (body.expected_internal_cost ?? 0) - (body.expected_other_cost ?? 0) - (body.risk_amount ?? 0),
    comment: body.comment ?? '',
    status: body.status ?? 'draft',
    submitted_at: body.submitted_at ?? null,
    approved_at: body.approved_at ?? null,
    approved_by: body.approved_by ?? null,
    returned_comment: body.returned_comment ?? null,
    created_at: now,
    updated_at: now,
  }
  const { error } = await getSupabaseAdmin().from('project_forecasts').insert(newForecast)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newForecast, { status: 201 })
}
