import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { TimeType } from '@/types'

export async function GET() {
  // time_types inneholder cost_per_hour (intern timekost) — kun admin-roller.
  // Eneste forbruker er admin-prognosesiden; UE/byggeleder skal aldri se ratene.
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const { data, error } = await getSupabaseAdmin().from('time_types').select('*')
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  // Time types change rarely — let the browser cache for 60s + serve
  // stale-while-revalidate for another 2 minutes.
  return NextResponse.json((data ?? []) as TimeType[], {
    headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { name?: string; cost_per_hour?: number }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Navn er påkrevd' }, { status: 400 })
  }
  const cost = Number(body.cost_per_hour)
  if (!Number.isFinite(cost) || cost < 0) {
    return NextResponse.json({ error: 'Kostnad må være et ikke-negativt tall' }, { status: 400 })
  }

  const newType: TimeType = {
    id: randomUUID(),
    name: body.name.trim(),
    cost_per_hour: cost,
    active: true,
  }
  const { error } = await getSupabaseAdmin().from('time_types').insert(newType)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newType, { status: 201 })
}
