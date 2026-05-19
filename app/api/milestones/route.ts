import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/data'
import { requireAuth, requireAdmin, isSub } from '@/lib/api-guard'
import { DEFAULT_MILESTONE_COLOR } from '@/lib/milestone-colors'
import type { GanttMilestone, ProjectSubcontractor } from '@/types'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project_id')
  const subcontractorId = searchParams.get('subcontractor_id')

  let milestones = await readJson<GanttMilestone>('milestones.json')
  if (projectId) milestones = milestones.filter((m) => m.project_id === projectId)
  if (subcontractorId) milestones = milestones.filter((m) => m.subcontractor_id === subcontractorId)

  if (isSub(auth.user)) {
    const subId = auth.user.subcontractor_id
    if (!subId) return NextResponse.json([])
    const links = await readJson<ProjectSubcontractor>('project_subcontractors.json')
    const allowedProjectIds = new Set(
      links.filter((l) => l.subcontractor_id === subId).map((l) => l.project_id)
    )
    milestones = milestones.filter(
      (m) =>
        allowedProjectIds.has(m.project_id) &&
        (m.subcontractor_id == null || m.subcontractor_id === subId)
    )
  }

  return NextResponse.json(milestones)
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const body = await req.json()
  const milestones = await readJson<GanttMilestone>('milestones.json')
  const newItem: GanttMilestone = {
    id: randomUUID(),
    project_id: body.project_id,
    subcontractor_id: body.subcontractor_id ?? null,
    title: body.title,
    start_date: body.start_date,
    end_date: body.end_date,
    color: body.color ?? DEFAULT_MILESTONE_COLOR,
    created_at: new Date().toISOString(),
  }
  milestones.push(newItem)
  await writeJson('milestones.json', milestones)
  return NextResponse.json(newItem, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const body = await req.json()
  const milestones = await readJson<GanttMilestone>('milestones.json')
  const idx = milestones.findIndex((m) => m.id === body.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  milestones[idx] = { ...milestones[idx], ...body }
  await writeJson('milestones.json', milestones)
  return NextResponse.json(milestones[idx])
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const updates = await req.json() as { id: string; sort_order: number }[]
  const milestones = await readJson<GanttMilestone>('milestones.json')
  for (const { id, sort_order } of updates) {
    const idx = milestones.findIndex((m) => m.id === id)
    if (idx !== -1) milestones[idx] = { ...milestones[idx], sort_order }
  }
  await writeJson('milestones.json', milestones)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const milestones = await readJson<GanttMilestone>('milestones.json')
  const filtered = milestones.filter((m) => m.id !== id)
  await writeJson('milestones.json', filtered)
  return NextResponse.json({ ok: true })
}
