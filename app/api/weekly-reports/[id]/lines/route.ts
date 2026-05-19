import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { WeeklyReport, WeeklyReportLine, ProjectBudgetLine } from '@/types'

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

  const body = await request.json() as {
    lines: Array<{ project_budget_line_id: string; reported_quantity: number; comment: string }>
  }

  // Validate every project_budget_line_id belongs to the same project as the
  // weekly report AND is owned by the reporting UE AND is a subcontractor_work
  // line. Without this check, UE could rapport mengde mot internkost/materiell
  // eller mot andre UEers linjer.
  if (isSub(session)) {
    const ids = body.lines.map((l) => l.project_budget_line_id)
    if (ids.length > 0) {
      const allBudgetLines = await readJson<ProjectBudgetLine>('project_budget_lines.json')
      const blMap = new Map(allBudgetLines.map((bl) => [bl.id, bl]))
      for (const lineId of ids) {
        const bl = blMap.get(lineId)
        if (
          !bl ||
          bl.project_id !== report.project_id ||
          bl.assigned_subcontractor_id !== session.subcontractor_id ||
          (bl.line_type != null && bl.line_type !== 'subcontractor_work')
        ) {
          return NextResponse.json({ error: 'Ugyldig budsjettlinje' }, { status: 403 })
        }
      }
    }
  }

  const allLines = await readJson<WeeklyReportLine>('weekly_report_lines.json')
  const updated = [...allLines]

  body.lines.forEach((input) => {
    const idx = updated.findIndex(
      (l) => l.weekly_report_id === params.id && l.project_budget_line_id === input.project_budget_line_id
    )
    if (idx !== -1) {
      updated[idx] = { ...updated[idx], reported_quantity: input.reported_quantity, comment: input.comment }
    } else {
      updated.push({
        id: randomUUID(),
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
