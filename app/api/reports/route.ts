import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, getProjectScope } from '@/lib/api-guard'

type LegacyReport = {
  id: string
  project_id: string
  subcontractor_id: string
  date: string
  status: string
  created_at: string
  updated_at: string
  lines: Array<{ product_id: string; quantity: number; comment: string | null }>
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const params = new URL(request.url).searchParams
  const projectId = params.get('project_id')
  const subcontractorId = params.get('subcontractor_id')

  const sb = getSupabaseAdmin()
  const query = sb.from('reports').select('*')
  if (projectId) query.eq('project_id', projectId)
  if (subcontractorId) query.eq('subcontractor_id', subcontractorId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let reports = (data ?? []) as LegacyReport[]

  const scope = await getProjectScope(auth.user)
  if (scope) reports = reports.filter((r) => scope.has(r.project_id))

  return NextResponse.json(reports)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Omit<LegacyReport, 'id' | 'status' | 'created_at' | 'updated_at'>
  const now = new Date().toISOString()
  const newReport: LegacyReport = {
    id: randomUUID(),
    ...body,
    status: 'submitted',
    created_at: now,
    updated_at: now,
  }
  const { error } = await getSupabaseAdmin().from('reports').insert(newReport)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newReport, { status: 201 })
}
