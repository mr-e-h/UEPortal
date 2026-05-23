import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import type { WeeklyReport } from '@/types'

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const sb = getSupabaseAdmin()

  const { data: report, error } = await sb
    .from('weekly_reports')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<WeeklyReport>()
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (isSub(session)) {
    if (report.subcontractor_id !== session.subcontractor_id) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }
  } else if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  if (report.status !== 'draft') {
    return NextResponse.json({ error: 'Rapporten er allerede sendt inn' }, { status: 409 })
  }

  // Only need to know if AT LEAST one line has qty > 0. Pull just the qty column.
  const { data: lines } = await sb
    .from('weekly_report_lines')
    .select('reported_quantity')
    .eq('weekly_report_id', params.id)
    .gt('reported_quantity', 0)
    .limit(1)
  if (!lines || lines.length === 0) {
    return NextResponse.json({ error: 'Minst én linje må ha rapportert mengde > 0' }, { status: 400 })
  }

  const { data: updated, error: updErr } = await sb
    .from('weekly_reports')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('status', 'draft') // guard against race — only transition draft → submitted
    .select()
    .maybeSingle<WeeklyReport>()
  if (updErr) return NextResponse.json({ error: 'Innsending feilet' }, { status: 500 })
  if (!updated) {
    return NextResponse.json({ error: 'Rapporten er allerede sendt inn' }, { status: 409 })
  }

  return NextResponse.json(updated)
}
