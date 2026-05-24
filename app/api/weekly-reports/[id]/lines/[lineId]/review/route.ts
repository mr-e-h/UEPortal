import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { WeeklyReport, WeeklyReportLine, WeeklyReportStatus } from '@/types'

/**
 * Per-line approve/reject. After updating the line, we re-derive the parent
 * report's aggregate status (all approved → 'approved', all rejected →
 * 'rejected', otherwise 'partially_approved') and write that back.
 *
 * Each step is a targeted Postgres update instead of a read-everything,
 * mutate-array, write-everything pattern.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; lineId: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { status: 'approved' | 'rejected' }
  if (body.status !== 'approved' && body.status !== 'rejected') {
    return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
  }
  const actor = auth.user.full_name
  const now = new Date().toISOString()
  const sb = getSupabaseAdmin()

  // PM gate via the parent report's project.
  const { data: report } = await sb
    .from('weekly_reports')
    .select('project_id')
    .eq('id', params.id)
    .maybeSingle<Pick<WeeklyReport, 'project_id'>>()
  if (report) {
    const denied = await ensureProjectWritable(auth.user, report.project_id)
    if (denied) return denied
  }

  const { data: updatedLine, error: lineErr } = await sb
    .from('weekly_report_lines')
    .update({ status: body.status, reviewed_at: now, reviewed_by: actor })
    .eq('id', params.lineId)
    .select()
    .maybeSingle<WeeklyReportLine>()
  if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 500 })
  if (!updatedLine) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Re-derive the report's aggregate status.
  const { data: reportLines, error: readErr } = await sb
    .from('weekly_report_lines')
    .select('status')
    .eq('weekly_report_id', params.id)
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })

  const lines = (reportLines ?? []) as Pick<WeeklyReportLine, 'status'>[]
  const allApproved = lines.length > 0 && lines.every((l) => l.status === 'approved')
  const allRejected = lines.length > 0 && lines.every((l) => l.status === 'rejected')
  const newStatus: WeeklyReportStatus = allApproved
    ? 'approved'
    : allRejected
      ? 'rejected'
      : 'partially_approved'

  await sb
    .from('weekly_reports')
    .update({ status: newStatus, reviewed_at: now, reviewed_by: actor })
    .eq('id', params.id)

  return NextResponse.json(updatedLine)
}
