import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectForecast, ForecastStatus } from '@/types'

// expected_profit + *_snapshot er bevisst utelatt: profit beregnes server-side
// fra de fem økonomi-feltene (se PATCH), og snapshot-feltene er fjernet (ble
// aldri lest). Klienten kan ikke sette noen av dem direkte lenger.
const EDITABLE_FIELDS: (keyof ProjectForecast)[] = [
  'project_manager_id',
  'expected_revenue',
  'expected_ue_cost',
  'expected_internal_cost',
  'expected_other_cost',
  'risk_amount',
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

  // PM gate: same project scope the PATCH handler enforces — a PM must not be
  // able to read a forecast (incl. its economy fields) for a project they are
  // not assigned to by guessing its id.
  const denied = await ensureProjectWritable(auth.user, data.project_id)
  if (denied) return denied

  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<ProjectForecast>

  const sb = getSupabaseAdmin()
  // PM gate via the forecast's project. Henter også de fem økonomi-feltene så
  // expected_profit kan beregnes på nytt fra den sammenslåtte tilstanden.
  const { data: existing } = await sb
    .from('project_forecasts')
    .select('project_id, expected_revenue, expected_ue_cost, expected_internal_cost, expected_other_cost, risk_amount')
    .eq('id', params.id)
    .maybeSingle<Pick<ProjectForecast, 'project_id' | 'expected_revenue' | 'expected_ue_cost' | 'expected_internal_cost' | 'expected_other_cost' | 'risk_amount'>>()
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
  // expected_profit er alltid avledet (aldri klient-styrt): inntekt − UE-kost −
  // internkost − annen kost − risiko, fra eksisterende verdier flettet med endringene.
  const m: Partial<ProjectForecast> = { ...(existing ?? {}), ...updates }
  updates.expected_profit =
    (m.expected_revenue ?? 0) - (m.expected_ue_cost ?? 0) - (m.expected_internal_cost ?? 0) - (m.expected_other_cost ?? 0) - (m.risk_amount ?? 0)

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
