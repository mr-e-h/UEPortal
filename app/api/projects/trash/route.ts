import { NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { Project } from '@/types'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  return NextResponse.json(readJson<Project>('projects.json').filter((p) => p.deleted))
}
