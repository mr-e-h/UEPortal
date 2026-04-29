import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import type { ForecastPeriod } from '@/types'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json() as Partial<ForecastPeriod>
  const periods = readJson<ForecastPeriod>('forecast_periods.json')
  const idx = periods.findIndex((p) => p.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  periods[idx] = { ...periods[idx], ...body }
  writeJson('forecast_periods.json', periods)
  return NextResponse.json(periods[idx])
}
