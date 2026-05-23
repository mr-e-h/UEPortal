import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { ForecastPeriod, ForecastPeriodStatus } from '@/types'

// Only lock-related fields can be flipped via the API. Period definition
// (name, year, start_month, end_month) is fixed once created.
const EDITABLE_FIELDS: (keyof ForecastPeriod)[] = [
  'status', 'locked', 'locked_at', 'locked_by',
]

const VALID_STATUSES: ForecastPeriodStatus[] = ['open', 'locked']

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<ForecastPeriod>
  const updates: Partial<ForecastPeriod> = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in body) (updates as Record<string, unknown>)[field] = body[field]
  }
  if (updates.status && !VALID_STATUSES.includes(updates.status)) {
    return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Ingen felter å oppdatere' }, { status: 400 })
  }

  const { data, error } = await getSupabaseAdmin()
    .from('forecast_periods')
    .update(updates)
    .eq('id', params.id)
    .select()
    .maybeSingle<ForecastPeriod>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}
