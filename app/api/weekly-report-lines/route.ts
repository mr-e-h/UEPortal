import { NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { requireAdmin, getProjectScope } from '@/lib/api-guard'
import type { WeeklyReportLine, WeeklyReport } from '@/types'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const lines = await readJson<WeeklyReportLine>('weekly_report_lines.json')

  // PM scope: filter lines to those belonging to reports for projects this
  // PM is assigned to. main / company see everything (scope is null).
  const scope = await getProjectScope(auth.user)
  if (!scope) return NextResponse.json(lines)

  const reports = await readJson<WeeklyReport>('weekly_reports.json')
  const scopedReportIds = new Set(
    reports.filter((r) => scope.has(r.project_id)).map((r) => r.id),
  )
  return NextResponse.json(lines.filter((l) => scopedReportIds.has(l.weekly_report_id)))
}
