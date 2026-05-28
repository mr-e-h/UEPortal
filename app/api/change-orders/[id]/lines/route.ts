import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { ChangeOrderLine } from '@/types'

/**
 * Return all lines for one change order, oldest-first (by sort_order then
 * created_at). Admins see customer-pricing fields; UEs get them stripped at
 * the response layer.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const sb = getSupabaseAdmin()

  // For subs: verify EM ownership before returning anything.
  if (!isAdmin(session)) {
    if (!isSub(session)) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    const { data: owner } = await sb
      .from('change_orders')
      .select('subcontractor_id')
      .eq('id', params.id)
      .maybeSingle<{ subcontractor_id: string }>()
    if (!owner || owner.subcontractor_id !== session.subcontractor_id) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }
  }

  const { data, error } = await sb
    .from('change_order_lines')
    .select('*')
    .eq('change_order_id', params.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let lines = (data ?? []) as ChangeOrderLine[]

  // UE strip: hide customer-side prices. They still see qty, product, unit
  // and their own cost snapshot.
  if (isSub(session)) {
    lines = lines.map((l) => {
      const { customer_price_snapshot: _cp, ...rest } = l
      return rest as ChangeOrderLine
    })
  }

  return NextResponse.json(lines)
}
