import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const sb = getSupabaseAdmin()
  // PM gate via the invoice's project.
  const { data: existing } = await sb
    .from('project_invoices')
    .select('project_id')
    .eq('id', params.id)
    .maybeSingle<{ project_id: string }>()
  if (existing) {
    const denied = await ensureProjectWritable(auth.user, existing.project_id)
    if (denied) return denied
  }

  const { error, count } = await sb
    .from('project_invoices')
    .delete({ count: 'exact' })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
