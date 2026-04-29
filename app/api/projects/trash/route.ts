import { NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import type { Project } from '@/types'

export async function GET() {
  return NextResponse.json(readJson<Project>('projects.json').filter((p) => p.deleted))
}
