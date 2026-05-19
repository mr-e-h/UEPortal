import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'

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
  let reports = readJson<LegacyReport>('reports.json')
  const projectId = params.get('project_id')
  const subcontractorId = params.get('subcontractor_id')
  if (projectId) reports = reports.filter((r) => r.project_id === projectId)
  if (subcontractorId) reports = reports.filter((r) => r.subcontractor_id === subcontractorId)
  return NextResponse.json(reports)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Omit<LegacyReport, 'id' | 'status' | 'created_at' | 'updated_at'>
  const reports = readJson<LegacyReport>('reports.json')
  const now = new Date().toISOString()
  const newReport: LegacyReport = { id: String(Date.now()), ...body, status: 'submitted', created_at: now, updated_at: now }
  writeJson('reports.json', [...reports, newReport])
  return NextResponse.json(newReport, { status: 201 })
}
