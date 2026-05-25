import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { ReportLine } from '@/types'

const VALID: ReportLine['status'][] = ['draft', 'submitted', 'approved', 'rejected']

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { status } = await request.json() as { status: string }
  if (!VALID.includes(status as ReportLine['status'])) {
    return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
  }

  // PM write gate via the line's project_id. Look up first so we 404 before
  // bothering with the scope check (PMs poking at other PMs' line ids).
  const sb = getSupabaseAdmin()
  const { data: line } = await sb
    .from('report_lines')
    .select('project_id')
    .eq('id', params.id)
    .maybeSingle<{ project_id: string }>()
  if (!line) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  const denied = await ensureProjectWritable(auth.user, line.project_id)
  if (denied) return denied

  const { data, error } = await sb
    .from('report_lines')
    .update({ status })
    .eq('id', params.id)
    .select()
    .maybeSingle<ReportLine>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}
