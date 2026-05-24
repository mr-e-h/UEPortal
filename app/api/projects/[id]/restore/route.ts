import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const denied = await ensureProjectWritable(auth.user, params.id)
  if (denied) return denied

  const { error, count } = await getSupabaseAdmin()
    .from('projects')
    .update({ deleted: false, deleted_at: null }, { count: 'exact' })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: 'Gjenoppretting feilet' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json({ success: true })
}
