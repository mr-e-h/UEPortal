import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAdmin } from '@/lib/api-guard'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { ActivityEntry } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const entityId = searchParams.get('entity_id')
  const entityType = searchParams.get('entity_type')

  // Filter at the DB layer so we don't load the entire activity log.
  let q = getSupabaseAdmin().from('activity_log').select('*').order('created_at', { ascending: true })
  if (entityId) q = q.eq('entity_id', entityId)
  if (entityType) q = q.eq('entity_type', entityType)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    entity_type: 'weekly_report' | 'change_order'
    entity_id: string
    comment: string
  }

  const entry: ActivityEntry = {
    id: randomUUID(),
    entity_type: body.entity_type,
    entity_id: body.entity_id,
    action: 'commented',
    // Actor derived from session — clients can't spoof it.
    actor: auth.user.full_name,
    comment: body.comment,
    created_at: new Date().toISOString(),
  }
  // Per-row insert avoids the read-modify-write race in writeJson.
  const { error } = await getSupabaseAdmin().from('activity_log').insert(entry)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(entry)
}
