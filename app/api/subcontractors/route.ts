import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin, requireAuth } from '@/lib/api-guard'
import type { Subcontractor } from '@/types'

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  return NextResponse.json(readJson<Subcontractor>('subcontractors.json'))
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Omit<Subcontractor, 'id'>
  const subcontractors = readJson<Subcontractor>('subcontractors.json')
  const newSub: Subcontractor = { ...body, id: randomUUID(), active: body.active ?? true }
  writeJson('subcontractors.json', [...subcontractors, newSub])
  return NextResponse.json(newSub, { status: 201 })
}
