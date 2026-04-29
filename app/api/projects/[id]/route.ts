import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import type { Project } from '@/types'

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  const body = await request.json() as Partial<Project>
  const projects = readJson<Project>('projects.json')
  const idx = projects.findIndex((p) => p.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  projects[idx] = { ...projects[idx], ...body, id }
  writeJson('projects.json', projects)
  return NextResponse.json(projects[idx])
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  const projects = readJson<Project>('projects.json')
  const idx = projects.findIndex((p) => p.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  projects[idx] = { ...projects[idx], deleted: true, deleted_at: new Date().toISOString() }
  writeJson('projects.json', projects)
  return NextResponse.json({ success: true })
}
