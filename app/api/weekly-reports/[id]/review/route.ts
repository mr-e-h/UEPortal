import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { WeeklyReport, WeeklyReportLine, ActivityEntry } from '@/types'

async function logActivity(
  entityId: string,
  action: ActivityEntry['action'],
  actor: string,
  comment?: string
): Promise<void> {
  const entries = await readJson<ActivityEntry>('activity_log.json')
  entries.push({
    id: randomUUID(),
    entity_type: 'weekly_report',
    entity_id: entityId,
    action,
    actor,
    comment,
    created_at: new Date().toISOString(),
  })
  await writeJson('activity_log.json', entries)
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    action: 'approve_all' | 'reject_all' | 'revert'
    admin_comment?: string
  }

  const reports = await readJson<WeeklyReport>('weekly_reports.json')
  const idx = reports.findIndex((r) => r.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()
  // Actor derived from session — clients can't spoof identity.
  const actor = auth.user.full_name
  const allLines = await readJson<WeeklyReportLine>('weekly_report_lines.json')

  if (body.action === 'revert') {
    await writeJson(
      'weekly_report_lines.json',
      allLines.map((l) =>
        l.weekly_report_id === params.id ? { ...l, status: 'pending', reviewed_at: null, reviewed_by: null } : l
      )
    )
    reports[idx] = {
      ...reports[idx],
      status: 'submitted',
      reviewed_at: null,
      reviewed_by: null,
      admin_comment: null,
    }
    await writeJson('weekly_reports.json', reports)
    await logActivity(params.id, 'reverted', actor, body.admin_comment)
    return NextResponse.json(reports[idx])
  }

  const lineStatus = body.action === 'approve_all' ? 'approved' as const : 'rejected' as const
  const reportStatus = body.action === 'approve_all' ? 'approved' as const : 'rejected' as const

  await writeJson(
    'weekly_report_lines.json',
    allLines.map((l) =>
      l.weekly_report_id === params.id
        ? { ...l, status: lineStatus, reviewed_at: now, reviewed_by: actor }
        : l
    )
  )

  reports[idx] = {
    ...reports[idx],
    status: reportStatus,
    reviewed_at: now,
    reviewed_by: actor,
    admin_comment: body.admin_comment ?? null,
  }
  await writeJson('weekly_reports.json', reports)
  await logActivity(
    params.id,
    body.action === 'approve_all' ? 'approved' : 'rejected',
    actor,
    body.admin_comment
  )

  return NextResponse.json(reports[idx])
}
