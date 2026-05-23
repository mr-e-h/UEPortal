import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { TimeType } from '@/types'

const EDITABLE_FIELDS: (keyof TimeType)[] = ['name', 'cost_per_hour', 'active']

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<TimeType>
  const updates: Partial<TimeType> = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in body) (updates as Record<string, unknown>)[field] = body[field]
  }
  if (updates.cost_per_hour !== undefined) {
    const n = Number(updates.cost_per_hour)
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'Kostnad må være et ikke-negativt tall' }, { status: 400 })
    }
    updates.cost_per_hour = n
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Ingen felter å oppdatere' }, { status: 400 })
  }

  const { data, error } = await getSupabaseAdmin()
    .from('time_types')
    .update(updates)
    .eq('id', params.id)
    .select()
    .maybeSingle<TimeType>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}
