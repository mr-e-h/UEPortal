import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'

export type ForecastExtra = {
  id: string
  project_id: string
  type: 'role' | 'custom' | 'comment'
  role: 'pm' | 'bl' | 'dok' | null
  line_name: string | null
  year: number
  month: number
  value: number
  text?: string
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  let rows = readJson<ForecastExtra>('project_forecast_extras.json')
  if (projectId) rows = rows.filter((r) => r.project_id === projectId)
  return NextResponse.json(rows)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    project_id: string
    rows: Omit<ForecastExtra, 'id'>[]
  }

  const all = readJson<ForecastExtra>('project_forecast_extras.json')
  const kept = all.filter((r) => r.project_id !== body.project_id)
  const newRows: ForecastExtra[] = body.rows.map((r) => ({
    ...r,
    id: randomUUID(),
  }))
  writeJson('project_forecast_extras.json', [...kept, ...newRows])
  return NextResponse.json(newRows, { status: 200 })
}
