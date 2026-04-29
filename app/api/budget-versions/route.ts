import { NextRequest, NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { requireAuth } from '@/lib/api-guard'
import type { BudgetVersion } from '@/types'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project_id')
  let versions = readJson<BudgetVersion>('budget_versions.json')
  if (projectId) versions = versions.filter((v) => v.project_id === projectId)
  return NextResponse.json(versions.sort((a, b) => a.version - b.version))
}
