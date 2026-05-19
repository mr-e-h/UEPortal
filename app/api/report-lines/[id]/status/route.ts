import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { ReportLine } from '@/types'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { status } = await request.json() as { status: ReportLine['status'] }
  const lines = await readJson<ReportLine>('report_lines.json')
  const idx = lines.findIndex((l) => l.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  lines[idx] = { ...lines[idx], status }
  await writeJson('report_lines.json', lines)
  return NextResponse.json(lines[idx])
}
