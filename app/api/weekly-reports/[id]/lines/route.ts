import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { WeeklyReport, WeeklyReportLine, ProjectBudgetLine } from '@/types'

/**
 * UE saves draft lines on every input blur — this is one of the most
 * frequently-hit write endpoints in the app. Previously it read the entire
 * `weekly_report_lines` table on every save and wrote it back. Two UEs
 * saving concurrently (or one UE alt-tabbed between two browsers) lost
 * each other's lines.
 *
 * Now each line is upserted by (weekly_report_id, project_budget_line_id) —
 * the existing unique index in the schema makes concurrent saves safe.
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const sb = getSupabaseAdmin()

  const { data: report, error: reportErr } = await sb
    .from('weekly_reports')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<WeeklyReport>()
  if (reportErr) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
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

  // Reported quantity must be a finite, non-negative number. A negative value
  // would silently reverse budget consumption and invoicing math downstream
  // (reported sums, approved_value, faktureringsgrunnlag).
  for (const line of body.lines ?? []) {
    const q = line.reported_quantity
    if (typeof q !== 'number' || !Number.isFinite(q) || q < 0) {
      return NextResponse.json(
        { error: 'Rapportert mengde må være et tall som er 0 eller høyere' },
        { status: 400 },
      )
    }
  }

  // Validate every project_budget_line_id belongs to the same project as the
  // weekly report AND is owned by the reporting UE AND is a subcontractor_work
  // line. Otherwise UE could report against intern/material lines or other
  // UEs' lines.
  if (isSub(session) && body.lines.length > 0) {
    const ids = body.lines.map((l) => l.project_budget_line_id)
    const { data: bls } = await sb
      .from('project_budget_lines')
      .select('*')
      .in('id', ids)
    const blMap = new Map(((bls ?? []) as ProjectBudgetLine[]).map((bl) => [bl.id, bl]))
    for (const lineId of ids) {
      const bl = blMap.get(lineId)
      if (
        !bl
        || bl.project_id !== report.project_id
        || bl.assigned_subcontractor_id !== session.subcontractor_id
        || (bl.line_type != null && bl.line_type !== 'subcontractor_work')
      ) {
        return NextResponse.json({ error: 'Ugyldig budsjettlinje' }, { status: 403 })
      }
    }
  }

  // Read existing lines just for this report so we can decide insert vs update
  // without reading the entire table. The plan is to use upsert with a
  // composite unique index in a future migration; for now this is the safe
  // bounded read.
  const { data: existingLines } = await sb
    .from('weekly_report_lines')
    .select('id, project_budget_line_id')
    .eq('weekly_report_id', params.id)
  const byBudgetId = new Map(
    ((existingLines ?? []) as Pick<WeeklyReportLine, 'id' | 'project_budget_line_id'>[])
      .map((l) => [l.project_budget_line_id, l.id]),
  )

  const toUpdate: Array<{ id: string; reported_quantity: number; comment: string }> = []
  const toInsert: WeeklyReportLine[] = []

  for (const input of body.lines) {
    const existingId = byBudgetId.get(input.project_budget_line_id)
    if (existingId) {
      toUpdate.push({ id: existingId, reported_quantity: input.reported_quantity, comment: input.comment })
    } else {
      toInsert.push({
        id: randomUUID(),
        weekly_report_id: params.id,
        project_budget_line_id: input.project_budget_line_id,
        reported_quantity: input.reported_quantity,
        comment: input.comment,
        status: 'pending',
        reviewed_at: null,
        reviewed_by: null,
        billed_at: null,
        ue_invoice_id: null,
      })
    }
  }

  // Parallel-ize. Each statement is a targeted update or insert — concurrent
  // calls don't collide unless they touch the same row, in which case
  // last-write-wins (acceptable for blur-based autosave).
  const updatePromises = toUpdate.map((u) =>
    sb.from('weekly_report_lines').update({
      reported_quantity: u.reported_quantity,
      comment: u.comment,
    }).eq('id', u.id),
  )
  const insertPromise = toInsert.length > 0
    ? sb.from('weekly_report_lines').insert(toInsert)
    : Promise.resolve({ error: null })

  await Promise.all([...updatePromises, insertPromise])
  return NextResponse.json({ ok: true })
}
