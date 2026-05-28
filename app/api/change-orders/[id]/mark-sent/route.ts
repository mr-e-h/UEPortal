import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { ChangeOrder } from '@/types'

/**
 * Mark a pending change-order as 'sent to customer'. Triggered by the
 * 'Eksporter PDF' button on the admin EM detail page so admins can see
 * which pending EMs are out for customer review vs untouched.
 *
 * The DB status stays 'pending' — we only stamp sent_to_customer_at and
 * write an audit-log row. Approving / rejecting / reverting from the
 * existing /status endpoint clears it back to null so we never carry
 * stale state.
 *
 * Admin-only and PM-scope-gated.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const sb = getSupabaseAdmin()

  const { data: order, error: readErr } = await sb
    .from('change_orders')
    .select('id, project_id, status')
    .eq('id', params.id)
    .maybeSingle<Pick<ChangeOrder, 'id' | 'project_id' | 'status'>>()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const denied = await ensureProjectWritable(auth.user, order.project_id)
  if (denied) return denied

  if (order.status !== 'pending') {
    return NextResponse.json({ error: 'Kun pending endringsmeldinger kan markeres som sendt til kunde' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { data: updated, error: updErr } = await sb
    .from('change_orders')
    .update({ sent_to_customer_at: now })
    .eq('id', params.id)
    .select()
    .maybeSingle<ChangeOrder>()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // Audit-log so the version log on the EM detail page shows it.
  await sb.from('activity_log').insert({
    id: randomUUID(),
    entity_type: 'change_order',
    entity_id: params.id,
    action: 'sent_to_customer',
    actor: auth.user.full_name,
    created_at: now,
  })

  return NextResponse.json(updated)
}
