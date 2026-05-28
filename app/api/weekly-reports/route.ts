import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getDeletedProjectIds } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { getProjectScope } from '@/lib/api-guard'
import type { WeeklyReport, WeeklyReportLine } from '@/types'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const subcontractorId = searchParams.get('subcontractor_id')
  const year = searchParams.get('year')
  const weekNumber = searchParams.get('week_number')
  const withLines = searchParams.get('with_lines') === 'true'
  const isSubRole = session.role === 'sub'

  const sb = getSupabaseAdmin()
  const query = sb.from('weekly_reports').select('*')
  if (isSubRole) {
    if (!session.subcontractor_id) return NextResponse.json([])
    query.eq('subcontractor_id', session.subcontractor_id)
  }
  if (projectId) query.eq('project_id', projectId)
  if (subcontractorId) query.eq('subcontractor_id', subcontractorId)
  if (year) query.eq('year', Number(year))
  if (weekNumber) query.eq('week_number', Number(weekNumber))

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let reports = (data ?? []) as WeeklyReport[]

  const deletedProjectIds = await getDeletedProjectIds()
  reports = reports.filter((r) => !deletedProjectIds.has(r.project_id))

  // PM scope: only see reports for assigned projects.
  // UE-role already filtered by subcontractor_id above.
  if (!isSubRole) {
    const scope = await getProjectScope(session)
    if (scope) reports = reports.filter((r) => scope.has(r.project_id))
  }

  if (withLines) {
    const reportIds = reports.map((r) => r.id)
    const { data: linesData } = reportIds.length > 0
      ? await sb.from('weekly_report_lines').select('*').in('weekly_report_id', reportIds)
      : { data: [] as WeeklyReportLine[] }
    const lines = (linesData ?? []) as WeeklyReportLine[]
    const byReport = new Map<string, WeeklyReportLine[]>()
    for (const l of lines) {
      const arr = byReport.get(l.weekly_report_id) ?? []
      arr.push(l)
      byReport.set(l.weekly_report_id, arr)
    }
    return NextResponse.json(reports.map((r) => ({ ...r, lines: byReport.get(r.id) ?? [] })))
  }

  return NextResponse.json(reports)
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const body = await request.json() as {
    project_id: string
    subcontractor_id: string
    year: number
    week_number: number
  }

  const isSubRole = session.role === 'sub'
  if (isSubRole && session.subcontractor_id !== body.subcontractor_id) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }
  if (!isSubRole && !['main', 'project_manager', 'company'].includes(session.role)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  // Closed-project gate — once the project is set to anything other than
  // 'active' (completed / archived), block new submissions so a UE can't
  // file fresh work against a project that's been wound down. Admin can
  // re-open the project to allow it again.
  const sbCheck = getSupabaseAdmin()
  const { data: proj } = await sbCheck
    .from('projects')
    .select('status, deleted')
    .eq('id', body.project_id)
    .maybeSingle<{ status: string; deleted: boolean | null }>()
  if (!proj || proj.deleted) {
    return NextResponse.json({ error: 'Prosjektet finnes ikke' }, { status: 404 })
  }
  if (proj.status !== 'active') {
    return NextResponse.json(
      { error: 'Prosjektet er lukket — admin må åpne det igjen for å rapportere' },
      { status: 409 },
    )
  }

  // submission_number is per (project, sub, year, week). Compute by count.
  // Race: two concurrent POSTs can read the same count and both write N+1.
  // Mitigation: rely on the parent unique index (if one exists) to bounce the
  // dup; if not, last-write-wins on submission_number is acceptable — it's
  // a display field, not a key. The real key is `id`.
  const sb = getSupabaseAdmin()
  const { count } = await sb
    .from('weekly_reports')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', body.project_id)
    .eq('subcontractor_id', body.subcontractor_id)
    .eq('year', body.year)
    .eq('week_number', body.week_number)

  const newReport: WeeklyReport = {
    id: randomUUID(), // randomUUID, not String(Date.now()) — collision-safe
    project_id: body.project_id,
    subcontractor_id: body.subcontractor_id,
    year: body.year,
    week_number: body.week_number,
    submission_number: (count ?? 0) + 1,
    status: 'draft',
    submitted_at: null,
    reviewed_at: null,
    reviewed_by: null,
    admin_comment: null,
    created_at: new Date().toISOString(),
  }
  const { error } = await sb.from('weekly_reports').insert(newReport)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newReport, { status: 201 })
}
