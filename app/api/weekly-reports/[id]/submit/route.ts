import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import type { WeeklyReport, WeeklyReportLine } from '@/types'

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const reports = readJson<WeeklyReport>('weekly_reports.json')
  const idx = reports.findIndex((r) => r.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const lines = readJson<WeeklyReportLine>('weekly_report_lines.json').filter((l) => l.weekly_report_id === params.id)
  if (!lines.some((l) => l.reported_quantity > 0)) {
    return NextResponse.json({ error: 'Minst én linje må ha rapportert mengde > 0' }, { status: 400 })
  }

  reports[idx] = { ...reports[idx], status: 'submitted', submitted_at: new Date().toISOString() }
  writeJson('weekly_reports.json', reports)
  return NextResponse.json(reports[idx])
}
