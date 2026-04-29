import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { TimeType } from '@/types'

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<TimeType>
  const types = readJson<TimeType>('time_types.json')
  const idx = types.findIndex((t) => t.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  if (body.cost_per_hour !== undefined) body.cost_per_hour = Number(body.cost_per_hour)
  types[idx] = { ...types[idx], ...body, id: params.id }
  writeJson('time_types.json', types)
  return NextResponse.json(types[idx])
}
