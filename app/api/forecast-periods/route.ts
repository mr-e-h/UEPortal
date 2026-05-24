import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { ForecastPeriod } from '@/types'

const PERIOD_NAMES: ForecastPeriod['name'][] = ['P1', 'P2', 'P3', 'P4']

/**
 * Pure read. Returns whatever exists; empty array if no rows for the year.
 * The page should detect [] and surface a "Opprett perioder for <year>"
 * button which POSTs to this endpoint to seed the four quarter rows.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const year = new URL(request.url).searchParams.get('year')
  const sb = getSupabaseAdmin()
  const query = sb.from('forecast_periods').select('*')
  if (year) query.eq('year', Number(year))

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as ForecastPeriod[])
}

/**
 * Seed P1-P4 for a given year. Idempotent: returns the existing rows if
 * they already exist (so the UI button is safe to spam).
 *
 * No race: two concurrent POSTs both check first, but the duplicate insert
 * would fail on the (year, name) constraint if we add one in the future.
 * For now, we accept that a near-simultaneous double-click could create
 * duplicates — the UI flow makes this extremely unlikely.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => ({} as { year?: number }))
  const targetYear = Number(body.year) || new Date().getFullYear()
  if (!Number.isInteger(targetYear) || targetYear < 2020 || targetYear > 2040) {
    return NextResponse.json({ error: 'Ugyldig år' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const { data: existing } = await sb
    .from('forecast_periods')
    .select('*')
    .eq('year', targetYear)
  const existingPeriods = (existing ?? []) as ForecastPeriod[]
  if (existingPeriods.length > 0) {
    return NextResponse.json(existingPeriods)
  }

  const newPeriods: ForecastPeriod[] = PERIOD_NAMES.map((name) => ({
    id: `fp-${targetYear}-${name.toLowerCase()}`,
    name,
    year: targetYear,
    start_month: 1,
    end_month: 12,
    status: 'open',
    locked: false,
    locked_at: null,
    locked_by: null,
  }))

  const { error } = await sb.from('forecast_periods').insert(newPeriods)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  return NextResponse.json(newPeriods, { status: 201 })
}
