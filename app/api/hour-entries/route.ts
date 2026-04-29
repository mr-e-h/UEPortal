import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { HourEntry, TimeType } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const entries = readJson<HourEntry>('hour_entries.json')
  return NextResponse.json(projectId ? entries.filter((e) => e.project_id === projectId) : entries)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { project_id: string; time_type_id: string; hours: number; date: string; comment?: string }
  const entries = readJson<HourEntry>('hour_entries.json')
  const types = readJson<TimeType>('time_types.json')
  const timeType = types.find((t) => t.id === body.time_type_id)
  const newEntry: HourEntry = {
    id: randomUUID(),
    project_id: body.project_id,
    time_type_id: body.time_type_id,
    hours: Number(body.hours),
    date: body.date,
    comment: body.comment ?? '',
    cost_per_hour_snapshot: timeType?.cost_per_hour ?? 0,
    created_at: new Date().toISOString(),
  }
  writeJson('hour_entries.json', [...entries, newEntry])
  return NextResponse.json(newEntry, { status: 201 })
}
