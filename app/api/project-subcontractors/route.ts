import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ProjectSubcontractor } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const params = new URL(request.url).searchParams
  let links = readJson<ProjectSubcontractor>('project_subcontractors.json')
  const projectId = params.get('project_id')
  const subcontractorId = params.get('subcontractor_id')
  if (projectId) links = links.filter((l) => l.project_id === projectId)
  if (subcontractorId) links = links.filter((l) => l.subcontractor_id === subcontractorId)
  return NextResponse.json(links)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Omit<ProjectSubcontractor, 'id'>
  const links = readJson<ProjectSubcontractor>('project_subcontractors.json')
  const exists = links.find((l) => l.project_id === body.project_id && l.subcontractor_id === body.subcontractor_id)
  if (exists) return NextResponse.json(exists)
  const newLink: ProjectSubcontractor = { ...body, id: randomUUID() }
  writeJson('project_subcontractors.json', [...links, newLink])
  return NextResponse.json(newLink, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const id = new URL(request.url).searchParams.get('id')
  const links = readJson<ProjectSubcontractor>('project_subcontractors.json')
  writeJson('project_subcontractors.json', links.filter((l) => l.id !== id))
  return NextResponse.json({ ok: true })
}
