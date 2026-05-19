import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { ForecastPeriod } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year')
  let periods = await readJson<ForecastPeriod>('forecast_periods.json')

  const targetYear = year ? Number(year) : new Date().getFullYear()

  // Auto-create periods for requested year if missing
  const existing = periods.filter((p) => p.year === targetYear)
  if (existing.length === 0) {
    const newPeriods: ForecastPeriod[] = [
      { id: `fp-${targetYear}-p1`, name: 'P1', year: targetYear, start_month: 1, end_month: 12, status: 'open', locked: false, locked_at: null, locked_by: null },
      { id: `fp-${targetYear}-p2`, name: 'P2', year: targetYear, start_month: 1, end_month: 12, status: 'open', locked: false, locked_at: null, locked_by: null },
      { id: `fp-${targetYear}-p3`, name: 'P3', year: targetYear, start_month: 1, end_month: 12, status: 'open', locked: false, locked_at: null, locked_by: null },
      { id: `fp-${targetYear}-p4`, name: 'P4', year: targetYear, start_month: 1, end_month: 12, status: 'open', locked: false, locked_at: null, locked_by: null },
    ]
    await writeJson('forecast_periods.json', [...periods, ...newPeriods])
    return NextResponse.json(newPeriods)
  }

  return NextResponse.json(existing)
}
