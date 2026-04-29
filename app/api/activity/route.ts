import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ActivityEntry } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const entityId = searchParams.get('entity_id')
  const entityType = searchParams.get('entity_type')
  let entries = readJson<ActivityEntry>('activity_log.json')
  if (entityId) entries = entries.filter((e) => e.entity_id === entityId)
  if (entityType) entries = entries.filter((e) => e.entity_type === entityType)
  entries.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return NextResponse.json(entries)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    entity_type: 'weekly_report' | 'change_order'
    entity_id: string
    action: 'commented'
    actor: string
    comment: string
  }
  const entries = readJson<ActivityEntry>('activity_log.json')
  const entry: ActivityEntry = {
    id: randomUUID(),
    entity_type: body.entity_type,
    entity_id: body.entity_id,
    action: 'commented',
    actor: body.actor,
    comment: body.comment,
    created_at: new Date().toISOString(),
  }
  entries.push(entry)
  writeJson('activity_log.json', entries)
  return NextResponse.json(entry)
}
