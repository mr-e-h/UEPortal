import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin, requireAuth, isSub } from '@/lib/api-guard'
import type { Subcontractor } from '@/types'

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  let subs = await readJson<Subcontractor>('subcontractors.json')
  // UE only sees their own subcontractor entry (used by /account etc).
  if (isSub(auth.user) && auth.user.subcontractor_id) {
    subs = subs.filter((s) => s.id === auth.user.subcontractor_id)
  } else if (isSub(auth.user)) {
    subs = []
  }
  return NextResponse.json(subs)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Omit<Subcontractor, 'id'>
  const subcontractors = await readJson<Subcontractor>('subcontractors.json')
  const newSub: Subcontractor = { ...body, id: randomUUID(), active: body.active ?? true }
  await writeJson('subcontractors.json', [...subcontractors, newSub])
  return NextResponse.json(newSub, { status: 201 })
}
