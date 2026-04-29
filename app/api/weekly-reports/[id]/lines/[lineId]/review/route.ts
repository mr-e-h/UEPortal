import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { WeeklyReport, WeeklyReportLine, WeeklyReportStatus } from '@/types'

export async function POST(request: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { status: 'approved' | 'rejected'; reviewed_by?: string }

  const allLines = readJson<WeeklyReportLine>('weekly_report_lines.json')
  const idx = allLines.findIndex((l) => l.id === params.lineId)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()
  allLines[idx] = { ...allLines[idx], status: body.status, reviewed_at: now, reviewed_by: body.reviewed_by ?? null }
  writeJson('weekly_report_lines.json', allLines)

  const reportLines = allLines.filter((l) => l.weekly_report_id === params.id)
  const allApproved = reportLines.length > 0 && reportLines.every((l) => l.status === 'approved')
  const allRejected = reportLines.length > 0 && reportLines.every((l) => l.status === 'rejected')
  let newStatus: WeeklyReportStatus = 'partially_approved'
  if (allApproved) newStatus = 'approved'
  else if (allRejected) newStatus = 'rejected'

  const reports = readJson<WeeklyReport>('weekly_reports.json')
  const rIdx = reports.findIndex((r) => r.id === params.id)
  if (rIdx !== -1) {
    reports[rIdx] = { ...reports[rIdx], status: newStatus, reviewed_at: now, reviewed_by: body.reviewed_by ?? null }
    writeJson('weekly_reports.json', reports)
  }

  return NextResponse.json(allLines[idx])
}
