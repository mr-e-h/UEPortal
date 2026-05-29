import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { ActivityEntry } from '@/types'

// Keys that contain customer-side pricing. Stripped fra metadata.before/after
// rekursivt når requester er UE, så Versjonslogg-popup aldri avslører
// Kundepris, Salgsverdi eller Fortjeneste — uansett hvor dypt i strukturen
// de ligger.
//
// Strukturen ble nestet i Prioritet 3:
//   metadata.before = { change_order: {...}, lines: [...], consequence_lines: [...] }
// så en flat top-level-strip leker dypere kundepriser. stripCustomerKeysDeep
// traverserer både objekt-trær og arrays.
const CUSTOMER_PRICING_KEYS = new Set(['customer_price_snapshot', 'total_customer_value', 'profit'])

function stripCustomerKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripCustomerKeysDeep(item))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!CUSTOMER_PRICING_KEYS.has(k)) {
        out[k] = stripCustomerKeysDeep(v)
      }
    }
    return out
  }
  return value
}

export async function GET(request: NextRequest) {
  // Subs can read activity for their own change_orders; admins can read all.
  // This unifies the Versjonslogg popup across both portals.
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const entityId = searchParams.get('entity_id')
  const entityType = searchParams.get('entity_type')

  // For non-admins, only allow access to their OWN change_order entities.
  if (!isAdmin(session)) {
    if (!isSub(session) || !entityId || entityType !== 'change_order') {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }
    // Ownership check: the requested EM must belong to this sub.
    const { data: order } = await getSupabaseAdmin()
      .from('change_orders')
      .select('subcontractor_id')
      .eq('id', entityId)
      .maybeSingle<{ subcontractor_id: string }>()
    if (!order || order.subcontractor_id !== session.subcontractor_id) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }
  }

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '200', 10) || 200, 500)
  let q = getSupabaseAdmin()
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (entityId) q = q.eq('entity_id', entityId)
  if (entityType) q = q.eq('entity_type', entityType)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let rows = (data ?? []) as ActivityEntry[]

  // UE strip: fjern kundepris-keys rekursivt fra diff-snapshots så
  // Versjonslogg-popup på UE-siden aldri avslører Salgsverdi/Profit —
  // også dypt i nested change_order/lines/consequence_lines-strukturen.
  if (isSub(session)) {
    rows = rows.map((r) => {
      if (!r.metadata) return r
      return {
        ...r,
        metadata: {
          before: stripCustomerKeysDeep(r.metadata.before) as Record<string, unknown> | undefined,
          after: stripCustomerKeysDeep(r.metadata.after) as Record<string, unknown> | undefined,
        },
      }
    })
  }

  // Callers expected oldest-first historically; sort the windowed result.
  return NextResponse.json(rows.slice().reverse())
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }
  const auth = { ok: true, user: session } as const

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
