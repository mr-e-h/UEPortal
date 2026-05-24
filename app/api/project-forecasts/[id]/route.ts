import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectForecast, ForecastStatus } from '@/types'

const EDITABLE_FIELDS: (keyof ProjectForecast)[] = [
  'project_manager_id',
  'total_sales_value_snapshot',
  'already_invoiced_snapshot',
  'remaining_invoice_value_snapshot',
  'expected_revenue',
  'expected_ue_cost',
  'expected_internal_cost',
  'expected_other_cost',
  'risk_amount',
  'expected_profit',
  'comment',
  'status',
  'submitted_at',
  'approved_at',
  'approved_by',
  'returned_comment',
]

const VALID_STATUSES: ForecastStatus[] = [
  'not_started', 'draft', 'submitted', 'approved', 'returned', 'locked',
]

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('project_forecasts')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<ProjectForecast>()
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<ProjectForecast>

  const sb = getSupabaseAdmin()
  // PM gate via the forecast's project.
  const { data: existing } = await sb
    .from('project_forecasts')
    .select('project_id')
    .eq('id', params.id)
    .maybeSingle<{ project_id: string }>()
  if (existing) {
    const denied = await ensureProjectWritable(auth.user, existing.project_id)
    if (denied) return denied
  }

  const updates: Partial<ProjectForecast> = { updated_at: new Date().toISOString() }
  for (const field of EDITABLE_FIELDS) {
    if (field in body) (updates as Record<string, unknown>)[field] = body[field]
  }
  if (updates.status && !VALID_STATUSES.includes(updates.status)) {
    return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
  }

  const { data, error } = await sb
    .from('project_forecasts')
    .update(updates)
    .eq('id', params.id)
    .select()
    .maybeSingle<ProjectForecast>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}
