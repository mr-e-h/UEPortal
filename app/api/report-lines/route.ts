import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson, getDeletedProjectIds } from '@/lib/data'
import type { ReportLine } from '@/types'

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const deletedProjectIds = getDeletedProjectIds()
  let lines = readJson<ReportLine>('report_lines.json').filter((l) => !deletedProjectIds.has(l.project_id))
  const projectId = params.get('project_id')
  const subcontractorId = params.get('subcontractor_id')
  const budgetLineId = params.get('budget_line_id')
  if (projectId) lines = lines.filter((l) => l.project_id === projectId)
  if (subcontractorId) lines = lines.filter((l) => l.subcontractor_id === subcontractorId)
  if (budgetLineId) lines = lines.filter((l) => l.project_budget_line_id === budgetLineId)
  return NextResponse.json(lines)
}

export async function POST(request: NextRequest) {
  const body = await request.json() as Omit<ReportLine, 'id' | 'status'>
  const lines = readJson<ReportLine>('report_lines.json')
  const newLine: ReportLine = {
    id: String(Date.now()),
    ...body,
    reported_quantity: Number(body.reported_quantity),
    status: 'submitted',
  }
  writeJson('report_lines.json', [...lines, newLine])
  return NextResponse.json(newLine, { status: 201 })
}
