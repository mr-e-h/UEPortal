import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { ProjectForecast } from '@/types'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const forecasts = await readJson<ProjectForecast>('project_forecasts.json')
  const forecast = forecasts.find((f) => f.id === params.id)
  if (!forecast) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(forecast)
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<ProjectForecast>
  const forecasts = await readJson<ProjectForecast>('project_forecasts.json')
  const idx = forecasts.findIndex((f) => f.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  forecasts[idx] = { ...forecasts[idx], ...body, updated_at: new Date().toISOString() }
  await writeJson('project_forecasts.json', forecasts)
  return NextResponse.json(forecasts[idx])
}
