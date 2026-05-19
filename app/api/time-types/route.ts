import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin, requireAuth } from '@/lib/api-guard'
import type { TimeType } from '@/types'

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  return NextResponse.json(await readJson<TimeType>('time_types.json'))
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { name: string; cost_per_hour: number }
  const types = await readJson<TimeType>('time_types.json')
  const newType: TimeType = {
    id: randomUUID(),
    name: body.name,
    cost_per_hour: Number(body.cost_per_hour),
    active: true,
  }
  await writeJson('time_types.json', [...types, newType])
  return NextResponse.json(newType, { status: 201 })
}
