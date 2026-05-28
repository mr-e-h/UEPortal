import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { ChangeOrder } from '@/types'

/**
 * Returnerer en pending EM tilbake til UE for revisjon. Status flippes til
 * 'revision_requested', admin_comment lagres så UE kan se hva som mangler,
 * og en activity-rad skrives så Versjonsloggen viser handlingen.
 *
 * UE-flyt etter dette: EMen dukker opp i UEs oppgaveboks (dashboard +
 * prosjekt-detalj), de kan åpne modal-en, lese kommentaren, rette opp,
 * og sende inn på nytt — da flippes status tilbake til 'pending' og en
 * 'resubmitted'-rad logges (håndtert av PUT-endepunktet).
 *
 * Admin-only og PM-scope-gated. Krever at EM er i 'pending'-tilstand.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { admin_comment } = await request.json() as { admin_comment?: string }

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
    return NextResponse.json(
      { error: 'Kun pending endringsmeldinger kan returneres til revisjon' },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()
  const { data: updated, error: updErr } = await sb
    .from('change_orders')
    .update({
      status: 'revision_requested',
      admin_comment: admin_comment ?? null,
      // EMen er ikke lenger hos kunden — den er tilbake hos UE.
      sent_to_customer_at: null,
    })
    .eq('id', params.id)
    .select()
    .maybeSingle<ChangeOrder>()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await sb.from('activity_log').insert({
    id: randomUUID(),
    entity_type: 'change_order',
    entity_id: params.id,
    action: 'revision_requested',
    actor: auth.user.full_name,
    comment: admin_comment,
    created_at: now,
  })

  return NextResponse.json(updated)
}
