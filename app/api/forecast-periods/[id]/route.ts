import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { ForecastPeriod } from '@/types'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<ForecastPeriod>
  const periods = await readJson<ForecastPeriod>('forecast_periods.json')
  const idx = periods.findIndex((p) => p.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  periods[idx] = { ...periods[idx], ...body }
  await writeJson('forecast_periods.json', periods)
  return NextResponse.json(periods[idx])
}
