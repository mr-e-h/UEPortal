import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'

const VALID = new Set(['draft', 'submitted', 'approved', 'rejected'])

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { status } = await request.json() as { status: string }
  if (!VALID.has(status)) {
    return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
  }

  // PM write gate via the report's project. Look up first so we 404 before
  // bothering with the scope check.
  const sb = getSupabaseAdmin()
  const { data: report } = await sb
    .from('reports')
    .select('project_id')
    .eq('id', params.id)
    .maybeSingle<{ project_id: string }>()
  if (!report) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  const denied = await ensureProjectWritable(auth.user, report.project_id)
  if (denied) return denied

  const { data, error } = await sb
    .from('reports')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}
