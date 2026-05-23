import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'

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

  const { data, error } = await getSupabaseAdmin()
    .from('reports')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}
