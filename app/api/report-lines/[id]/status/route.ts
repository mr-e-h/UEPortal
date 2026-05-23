import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
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

  const { data, error } = await getSupabaseAdmin()
    .from('report_lines')
    .update({ status })
    .eq('id', params.id)
    .select()
    .maybeSingle<ReportLine>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}
