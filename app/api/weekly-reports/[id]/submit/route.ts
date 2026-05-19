import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import type { WeeklyReport, WeeklyReportLine } from '@/types'

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const reports = readJson<WeeklyReport>('weekly_reports.json')
  const idx = reports.findIndex((r) => r.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const report = reports[idx]
  if (isSub(session)) {
    if (report.subcontractor_id !== session.subcontractor_id) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }
  } else if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  if (report.status !== 'draft') {
    return NextResponse.json({ error: 'Rapporten er allerede sendt inn' }, { status: 409 })
  }

  const lines = readJson<WeeklyReportLine>('weekly_report_lines.json').filter((l) => l.weekly_report_id === params.id)
  if (!lines.some((l) => l.reported_quantity > 0)) {
    return NextResponse.json({ error: 'Minst én linje må ha rapportert mengde > 0' }, { status: 400 })
  }

  reports[idx] = { ...reports[idx], status: 'submitted', submitted_at: new Date().toISOString() }
  writeJson('weekly_reports.json', reports)
  return NextResponse.json(reports[idx])
}
