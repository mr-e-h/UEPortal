import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, getProjectScope, ensureProjectWritable } from '@/lib/api-guard'

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

  const projectId = new URL(request.url).searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('project_forecast_extras').select('*')
  if (projectId) query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let rows = (data ?? []) as ForecastExtra[]

  const scope = await getProjectScope(auth.user)
  if (scope) rows = rows.filter((r) => scope.has(r.project_id))

  return NextResponse.json(rows)
}

/**
 * Replace-all upsert for a project. Scoped delete + insert is concurrent-safe
 * across different projects; same-project concurrent saves still last-write-wins.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    project_id: string
    rows: Omit<ForecastExtra, 'id'>[]
  }
  if (!body.project_id) {
    return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })
  }

  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const newRows: ForecastExtra[] = body.rows.map((r) => ({ ...r, id: randomUUID() }))

  const sb = getSupabaseAdmin()
  const { error: delErr } = await sb
    .from('project_forecast_extras')
    .delete()
    .eq('project_id', body.project_id)
  if (delErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  if (newRows.length > 0) {
    const { error: insErr } = await sb.from('project_forecast_extras').insert(newRows)
    if (insErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  }

  return NextResponse.json(newRows, { status: 200 })
}
