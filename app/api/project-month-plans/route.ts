import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, getProjectScope, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectMonthPlan } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('project_month_plans').select('*')
  if (projectId) query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let plans = (data ?? []) as ProjectMonthPlan[]

  // PM scope.
  const scope = await getProjectScope(auth.user)
  if (scope) plans = plans.filter((p) => scope.has(p.project_id))

  return NextResponse.json(plans)
}

/**
 * Replace-all-for-project upsert. Scoped delete + insert means two admins
 * editing different projects never collide. Same project + concurrent saves
 * still last-write-wins (acceptable for this UI — the editor has a single
 * draft + save button).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    project_id: string
    rows: Omit<ProjectMonthPlan, 'id' | 'updated_at'>[]
  }
  if (!body.project_id) {
    return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })
  }

  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const now = new Date().toISOString()
  const newRows: ProjectMonthPlan[] = body.rows.map((r) => ({
    id: `${body.project_id}-${r.year}-${r.month}`,
    project_id: body.project_id,
    year: r.year,
    month: r.month,
    expected_revenue: r.expected_revenue ?? 0,
    internal_hours: r.internal_hours ?? 0,
    internal_cost: r.internal_cost ?? 0,
    ue_cost: r.ue_cost ?? 0,
    other_cost: r.other_cost ?? 0,
    risk: r.risk ?? 0,
    comment: r.comment ?? '',
    updated_at: now,
  }))

  const sb = getSupabaseAdmin()
  // Drop the project's previous rows, then insert the new set. Two requests
  // serialize on the same project_id in practice — the editor doesn't run
  // these in parallel.
  const { error: delErr } = await sb
    .from('project_month_plans')
    .delete()
    .eq('project_id', body.project_id)
  if (delErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  if (newRows.length > 0) {
    const { error: insErr } = await sb.from('project_month_plans').insert(newRows)
    if (insErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  }

  return NextResponse.json(newRows, { status: 200 })
}
