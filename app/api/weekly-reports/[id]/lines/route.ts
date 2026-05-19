import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import type { WeeklyReport, WeeklyReportLine } from '@/types'

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const reports = await readJson<WeeklyReport>('weekly_reports.json')
  const report = reports.find((r) => r.id === params.id)
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (isSub(session)) {
    if (report.subcontractor_id !== session.subcontractor_id) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }
  } else if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  if (report.status !== 'draft') {
    return NextResponse.json({ error: 'Kan kun redigere kladder' }, { status: 409 })
  }

  const body = await request.json() as { lines: Array<{ project_budget_line_id: string; reported_quantity: number; comment: string }> }
  const allLines = await readJson<WeeklyReportLine>('weekly_report_lines.json')
  const updated = [...allLines]

  body.lines.forEach((input, i) => {
    const idx = updated.findIndex(
      (l) => l.weekly_report_id === params.id && l.project_budget_line_id === input.project_budget_line_id
    )
    if (idx !== -1) {
      updated[idx] = { ...updated[idx], reported_quantity: input.reported_quantity, comment: input.comment }
    } else {
      updated.push({
        id: `${Date.now()}-${i}`,
        weekly_report_id: params.id,
        project_budget_line_id: input.project_budget_line_id,
        reported_quantity: input.reported_quantity,
        comment: input.comment,
        status: 'pending',
        reviewed_at: null,
        reviewed_by: null,
        billed_at: null,
      })
    }
  })

  await writeJson('weekly_report_lines.json', updated)
  return NextResponse.json({ ok: true })
}
