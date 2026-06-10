import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireStaff, ensureProjectWritable } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { WeeklyReport, ActivityEntry } from '@/types'

/**
 * Append an audit row directly. The old impl read the whole activity_log
 * table, pushed one row, and wrote it back — a guaranteed dropped-write under
 * concurrent reviews.
 */
async function logActivity(
  entityId: string,
  action: ActivityEntry['action'],
  actor: string,
  comment?: string,
): Promise<void> {
  await getSupabaseAdmin().from('activity_log').insert({
    id: randomUUID(),
    entity_type: 'weekly_report',
    entity_id: entityId,
    action,
    actor,
    comment,
    created_at: new Date().toISOString(),
  })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  // Project staff incl. byggeleder — operational weekly-report review is a
  // site-manager duty. ensureProjectWritable below confines PM AND byggeleder
  // to their assigned projects (empty byggeleder scope → 403 on everything).
  const auth = await requireStaff()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    action: 'approve_all' | 'reject_all' | 'revert'
    admin_comment?: string
  }
  if (body.action !== 'approve_all' && body.action !== 'reject_all' && body.action !== 'revert') {
    return NextResponse.json({ error: 'Ugyldig handling' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const actor = auth.user.full_name
  const now = new Date().toISOString()

  // Make sure the report exists before doing any line work — also pull
  // project_id for the PM gate.
  const { data: report, error: readErr } = await sb
    .from('weekly_reports')
    .select('id, project_id')
    .eq('id', params.id)
    .maybeSingle<Pick<WeeklyReport, 'id' | 'project_id'>>()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const denied = await ensureProjectWritable(auth.user, report.project_id)
  if (denied) return denied

  if (body.action === 'revert') {
    // Reset every line for this report back to pending in one update.
    const { error: lineErr } = await sb
      .from('weekly_report_lines')
      .update({ status: 'pending', reviewed_at: null, reviewed_by: null })
      .eq('weekly_report_id', params.id)
    if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 500 })

    const { data: updated, error: updErr } = await sb
      .from('weekly_reports')
      .update({ status: 'submitted', reviewed_at: null, reviewed_by: null, admin_comment: null })
      .eq('id', params.id)
      .select()
      .maybeSingle<WeeklyReport>()
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    await logActivity(params.id, 'reverted', actor, body.admin_comment)
    return NextResponse.json(updated)
  }

  // Approve-all or reject-all: flip lines in one update, then the report header.
  const lineStatus = body.action === 'approve_all' ? 'approved' : 'rejected'
  const reportStatus = body.action === 'approve_all' ? 'approved' : 'rejected'

  const { error: lineErr } = await sb
    .from('weekly_report_lines')
    .update({ status: lineStatus, reviewed_at: now, reviewed_by: actor })
    .eq('weekly_report_id', params.id)
  if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 500 })

  const { data: updated, error: updErr } = await sb
    .from('weekly_reports')
    .update({
      status: reportStatus,
      reviewed_at: now,
      reviewed_by: actor,
      admin_comment: body.admin_comment ?? null,
    })
    .eq('id', params.id)
    .select()
    .maybeSingle<WeeklyReport>()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await logActivity(
    params.id,
    body.action === 'approve_all' ? 'approved' : 'rejected',
    actor,
    body.admin_comment,
  )

  return NextResponse.json(updated)
}
