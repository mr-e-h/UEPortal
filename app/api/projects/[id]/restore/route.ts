import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import type { Project } from '@/types'

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const projects = readJson<Project>('projects.json')
  const idx = projects.findIndex((p) => p.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  projects[idx] = { ...projects[idx], deleted: false, deleted_at: null }
  writeJson('projects.json', projects)
  return NextResponse.json({ success: true })
}
