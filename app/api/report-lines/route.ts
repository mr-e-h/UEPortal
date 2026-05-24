import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getDeletedProjectIds } from '@/lib/data'
import { requireAdmin, getProjectScope } from '@/lib/api-guard'
import type { ReportLine } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const params = new URL(request.url).searchParams
  const projectId = params.get('project_id')
  const subcontractorId = params.get('subcontractor_id')
  const budgetLineId = params.get('budget_line_id')

  const sb = getSupabaseAdmin()
  const query = sb.from('report_lines').select('*')
  if (projectId) query.eq('project_id', projectId)
  if (subcontractorId) query.eq('subcontractor_id', subcontractorId)
  if (budgetLineId) query.eq('project_budget_line_id', budgetLineId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let lines = (data ?? []) as ReportLine[]

  const deletedProjectIds = await getDeletedProjectIds()
  lines = lines.filter((l) => !deletedProjectIds.has(l.project_id))

  const scope = await getProjectScope(auth.user)
  if (scope) lines = lines.filter((l) => scope.has(l.project_id))

  return NextResponse.json(lines)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Omit<ReportLine, 'id' | 'status'>
  const newLine: ReportLine = {
    id: randomUUID(),
    ...body,
    reported_quantity: Number(body.reported_quantity),
    status: 'submitted',
  }
  const { error } = await getSupabaseAdmin().from('report_lines').insert(newLine)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newLine, { status: 201 })
}
