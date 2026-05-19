import { NextRequest, NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { requireAuth, isSub } from '@/lib/api-guard'
import type { BudgetVersion, ProjectSubcontractor } from '@/types'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project_id')
  let versions = await readJson<BudgetVersion>('budget_versions.json')
  if (projectId) versions = versions.filter((v) => v.project_id === projectId)

  // UE: limit to projects they are linked to, AND strip customer-side totals.
  if (isSub(auth.user)) {
    const subId = auth.user.subcontractor_id
    if (!subId) return NextResponse.json([])
    const links = await readJson<ProjectSubcontractor>('project_subcontractors.json')
    const allowedProjectIds = new Set(
      links.filter((l) => l.subcontractor_id === subId).map((l) => l.project_id)
    )
    versions = versions
      .filter((v) => allowedProjectIds.has(v.project_id))
      .map((v) => ({ ...v, total_sales_value: 0 }))
  }

  return NextResponse.json(versions.sort((a, b) => a.version - b.version))
}
