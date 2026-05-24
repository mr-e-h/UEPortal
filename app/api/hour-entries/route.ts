import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, getProjectScope } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { HourEntry, TimeType } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('hour_entries').select('*')
  if (projectId) query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let entries = (data ?? []) as HourEntry[]

  const scope = await getProjectScope(auth.user)
  if (scope) entries = entries.filter((e) => scope.has(e.project_id))

  return NextResponse.json(entries)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    project_id: string
    time_type_id: string
    hours: number
    date: string
    comment?: string
  }

  // Snapshot the hourly cost at write time so historical entries stay
  // accurate even after the time type's rate changes.
  const sb = getSupabaseAdmin()
  const { data: timeType } = await sb
    .from('time_types')
    .select('cost_per_hour')
    .eq('id', body.time_type_id)
    .maybeSingle<Pick<TimeType, 'cost_per_hour'>>()

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

  const { error } = await sb.from('hour_entries').insert(newEntry)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(newEntry, { status: 201 })
}
