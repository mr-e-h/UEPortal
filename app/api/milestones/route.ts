import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/data'
import { requireAuth } from '@/lib/api-guard'
import type { GanttMilestone } from '@/types'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project_id')
  const subcontractorId = searchParams.get('subcontractor_id')

  let milestones = readJson<GanttMilestone>('milestones.json')
  if (projectId) milestones = milestones.filter((m) => m.project_id === projectId)
  if (subcontractorId) milestones = milestones.filter((m) => m.subcontractor_id === subcontractorId)

  return NextResponse.json(milestones)
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const body = await req.json()
  const milestones = readJson<GanttMilestone>('milestones.json')
  const newItem: GanttMilestone = {
    id: randomUUID(),
    project_id: body.project_id,
    subcontractor_id: body.subcontractor_id ?? null,
    title: body.title,
    start_date: body.start_date,
    end_date: body.end_date,
    color: body.color ?? '#3B82F6',
    created_at: new Date().toISOString(),
  }
  milestones.push(newItem)
  writeJson('milestones.json', milestones)
  return NextResponse.json(newItem, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const body = await req.json()
  const milestones = readJson<GanttMilestone>('milestones.json')
  const idx = milestones.findIndex((m) => m.id === body.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  milestones[idx] = { ...milestones[idx], ...body }
  writeJson('milestones.json', milestones)
  return NextResponse.json(milestones[idx])
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const updates = await req.json() as { id: string; sort_order: number }[]
  const milestones = readJson<GanttMilestone>('milestones.json')
  for (const { id, sort_order } of updates) {
    const idx = milestones.findIndex((m) => m.id === id)
    if (idx !== -1) milestones[idx] = { ...milestones[idx], sort_order }
  }
  writeJson('milestones.json', milestones)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const milestones = readJson<GanttMilestone>('milestones.json')
  const filtered = milestones.filter((m) => m.id !== id)
  writeJson('milestones.json', filtered)
  return NextResponse.json({ ok: true })
}
