import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, getProjectScope, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectHourBudget } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('project_hour_budgets').select('*')
  if (projectId) query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let budgets = (data ?? []) as ProjectHourBudget[]

  const scope = await getProjectScope(auth.user)
  if (scope) budgets = budgets.filter((b) => scope.has(b.project_id))

  return NextResponse.json(budgets)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    project_id: string
    time_type_id: string
    estimated_hours: number
  }
  if (!body.project_id || !body.time_type_id) {
    return NextResponse.json({ error: 'project_id og time_type_id er påkrevd' }, { status: 400 })
  }
  const hours = Number(body.estimated_hours)
  if (!Number.isFinite(hours) || hours < 0) {
    return NextResponse.json({ error: 'Timer må være et ikke-negativt tall' }, { status: 400 })
  }

  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const newBudget: ProjectHourBudget = {
    id: randomUUID(), // was String(Date.now()) — collision-safe now
    project_id: body.project_id,
    time_type_id: body.time_type_id,
    estimated_hours: hours,
    created_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin().from('project_hour_budgets').insert(newBudget)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newBudget, { status: 201 })
}
