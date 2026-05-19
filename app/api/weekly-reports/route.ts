import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson, getDeletedProjectIds } from '@/lib/data'
import type { WeeklyReport, WeeklyReportLine } from '@/types'
import { getSession } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const subcontractorId = searchParams.get('subcontractor_id')
  const year = searchParams.get('year')
  const weekNumber = searchParams.get('week_number')
  const withLines = searchParams.get('with_lines') === 'true'

  const isSubRole = session.role === 'sub' || session.role === 'subcontractor'

  const deletedProjectIds = await getDeletedProjectIds()
  let reports = (await readJson<WeeklyReport>('weekly_reports.json')).filter((r) => !deletedProjectIds.has(r.project_id))

  if (isSubRole) {
    if (!session.subcontractor_id) return NextResponse.json([])
    reports = reports.filter((r) => r.subcontractor_id === session.subcontractor_id)
  }
  if (projectId) reports = reports.filter((r) => r.project_id === projectId)
  if (subcontractorId) reports = reports.filter((r) => r.subcontractor_id === subcontractorId)
  if (year) reports = reports.filter((r) => r.year === Number(year))
  if (weekNumber) reports = reports.filter((r) => r.week_number === Number(weekNumber))

  if (withLines) {
    const allLines = await readJson<WeeklyReportLine>('weekly_report_lines.json')
    return NextResponse.json(reports.map((r) => ({ ...r, lines: allLines.filter((l) => l.weekly_report_id === r.id) })))
  }

  return NextResponse.json(reports)
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const body = await request.json() as { project_id: string; subcontractor_id: string; year: number; week_number: number }

  const isSubRole = session.role === 'sub' || session.role === 'subcontractor'
  if (isSubRole && session.subcontractor_id !== body.subcontractor_id) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }
  if (!isSubRole && !['main', 'project_manager', 'company'].includes(session.role)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const reports = await readJson<WeeklyReport>('weekly_reports.json')

  const sameWeekCount = reports.filter(
    (r) => r.project_id === body.project_id && r.subcontractor_id === body.subcontractor_id &&
      r.year === body.year && r.week_number === body.week_number
  ).length

  const newReport: WeeklyReport = {
    id: String(Date.now()),
    project_id: body.project_id,
    subcontractor_id: body.subcontractor_id,
    year: body.year,
    week_number: body.week_number,
    submission_number: sameWeekCount + 1,
    status: 'draft',
    submitted_at: null,
    reviewed_at: null,
    reviewed_by: null,
    admin_comment: null,
    created_at: new Date().toISOString(),
  }
  await writeJson('weekly_reports.json', [...reports, newReport])
  return NextResponse.json(newReport, { status: 201 })
}
