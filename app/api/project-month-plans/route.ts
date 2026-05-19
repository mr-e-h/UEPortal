import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { ProjectMonthPlan } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  let plans = await readJson<ProjectMonthPlan>('project_month_plans.json')
  if (projectId) plans = plans.filter((p) => p.project_id === projectId)
  return NextResponse.json(plans)
}

// Batch upsert: receives all rows for a project, replaces existing
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { project_id: string; rows: Omit<ProjectMonthPlan, 'id' | 'updated_at'>[] }
  const all = await readJson<ProjectMonthPlan>('project_month_plans.json')
  const kept = all.filter((p) => p.project_id !== body.project_id)
  const now = new Date().toISOString()
  const newRows: ProjectMonthPlan[] = body.rows.map((r) => ({
    id: `${body.project_id}-${r.year}-${r.month}`,
    project_id: body.project_id,
    year: r.year,
    month: r.month,
    expected_revenue: r.expected_revenue ?? 0,
    internal_hours: r.internal_hours ?? 0,
    internal_cost: r.internal_cost ?? 0,
    ue_hours: r.ue_hours ?? 0,
    ue_cost: r.ue_cost ?? 0,
    other_cost: r.other_cost ?? 0,
    risk: r.risk ?? 0,
    comment: r.comment ?? '',
    updated_at: now,
  }))
  await writeJson('project_month_plans.json', [...kept, ...newRows])
  return NextResponse.json(newRows, { status: 200 })
}
