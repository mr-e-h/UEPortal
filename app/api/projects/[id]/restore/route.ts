import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireUserAdmin } from '@/lib/api-guard'

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  // Restore lives with the trash UI — main / company only, no PMs.
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const { error, count } = await getSupabaseAdmin()
    .from('projects')
    .update({ deleted: false, deleted_at: null }, { count: 'exact' })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: 'Gjenoppretting feilet' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json({ success: true })
}
