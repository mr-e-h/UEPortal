import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ProjectInternalCostEntry } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  let entries = await readJson<ProjectInternalCostEntry>('project_internal_costs.json')
  if (projectId) entries = entries.filter((e) => e.project_id === projectId)
  return NextResponse.json(entries)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { project_id: string; year: number; month: number; amount: number; comment: string }
  const all = await readJson<ProjectInternalCostEntry>('project_internal_costs.json')
  const entry: ProjectInternalCostEntry = {
    id: randomUUID(),
    project_id: body.project_id,
    year: body.year,
    month: body.month,
    amount: body.amount,
    comment: body.comment ?? '',
    created_at: new Date().toISOString(),
  }
  await writeJson('project_internal_costs.json', [...all, entry])
  return NextResponse.json(entry, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const all = await readJson<ProjectInternalCostEntry>('project_internal_costs.json')
  await writeJson('project_internal_costs.json', all.filter((e) => e.id !== id))
  return NextResponse.json({ ok: true })
}
