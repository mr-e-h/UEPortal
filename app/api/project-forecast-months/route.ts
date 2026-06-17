import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectForecastMonth } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  // forecast_id is required: without it the query would return EVERY project's
  // forecast months (incl. economy fields), unscoped — a PM leak. The app only
  // ever reads months for one forecast at a time, so demand the id.
  const forecastId = new URL(request.url).searchParams.get('forecast_id')
  if (!forecastId) return NextResponse.json({ error: 'forecast_id mangler' }, { status: 400 })

  const sb = getSupabaseAdmin()

  // PM gate via the parent forecast's project — same scope the POST handler
  // enforces. Without it a PM could read any forecast's months by supplying a
  // forecast_id from a project they aren't assigned to.
  const { data: parent } = await sb
    .from('project_forecasts')
    .select('project_id')
    .eq('id', forecastId)
    .maybeSingle<{ project_id: string }>()
  if (parent) {
    const denied = await ensureProjectWritable(auth.user, parent.project_id)
    if (denied) return denied
  }

  const { data, error } = await sb
    .from('project_forecast_months')
    .select('*')
    .eq('project_forecast_id', forecastId)
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

  // PM gate via the parent forecast's project.
  const sb = getSupabaseAdmin()
  const { data: parent } = await sb
    .from('project_forecasts')
    .select('project_id')
    .eq('id', body.forecast_id)
    .maybeSingle<{ project_id: string }>()
  if (parent) {
    const denied = await ensureProjectWritable(auth.user, parent.project_id)
    if (denied) return denied
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

  const { error: delErr } = await sb
    .from('project_forecast_months')
    .delete()
    .eq('project_forecast_id', body.forecast_id)
  if (delErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  if (newMonths.length > 0) {
    const { error: insErr } = await sb.from('project_forecast_months').insert(newMonths)
    if (insErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  }

  // Normaliser header-totalene: lagret header (project_forecasts) skal ALLTID
  // være = Σ av månedene. Header er nå avledet — vi lagrer ikke lenger separate
  // header-tall fra klienten (Pakke 3).
  const revenue = newMonths.reduce((s, m) => s + m.expected_revenue, 0)
  const ueCost = newMonths.reduce((s, m) => s + m.expected_ue_cost, 0)
  const internalCost = newMonths.reduce((s, m) => s + m.expected_internal_cost, 0)
  const otherCost = newMonths.reduce((s, m) => s + m.expected_other_cost, 0)
  const riskAmount = newMonths.reduce((s, m) => s + m.risk_amount, 0)
  await sb
    .from('project_forecasts')
    .update({
      expected_revenue: revenue,
      expected_ue_cost: ueCost,
      expected_internal_cost: internalCost,
      expected_other_cost: otherCost,
      risk_amount: riskAmount,
      expected_profit: revenue - ueCost - internalCost - otherCost - riskAmount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.forecast_id)

  return NextResponse.json(newMonths, { status: 201 })
}
