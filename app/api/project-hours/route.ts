import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { ProjectHourBudget } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const budgets = await readJson<ProjectHourBudget>('project_hour_budgets.json')
  return NextResponse.json(projectId ? budgets.filter((b) => b.project_id === projectId) : budgets)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { project_id: string; time_type_id: string; estimated_hours: number }
  const budgets = await readJson<ProjectHourBudget>('project_hour_budgets.json')
  const newBudget: ProjectHourBudget = {
    id: String(Date.now()),
    project_id: body.project_id,
    time_type_id: body.time_type_id,
    estimated_hours: Number(body.estimated_hours),
    created_at: new Date().toISOString(),
  }
  await writeJson('project_hour_budgets.json', [...budgets, newBudget])
  return NextResponse.json(newBudget, { status: 201 })
}
