import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import type { WeeklyReportLine } from '@/types'

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json() as { lines: Array<{ project_budget_line_id: string; reported_quantity: number; comment: string }> }
  const allLines = readJson<WeeklyReportLine>('weekly_report_lines.json')
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

  writeJson('weekly_report_lines.json', updated)
  return NextResponse.json({ ok: true })
}
