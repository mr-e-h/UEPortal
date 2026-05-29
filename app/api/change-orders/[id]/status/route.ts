import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ChangeOrder, ProjectBudgetLine, ActivityEntry, ChangeOrderConsequenceLine } from '@/types'

/**
 * Trekk konsekvens-mengdene fra prosjektbudsjettet — kjøres når en EM
 * avvises. For hver konsekvens-linje finner vi matchende budget_line
 * (samme project_id + product_id + assigned_subcontractor_id) og reduserer
 * mengden. Hvis budsjettet faller til 0, slettes linjen.
 *
 * Linjer som ikke finnes i prosjektbudsjettet (admin satt opp en
 * konsekvens som ikke matcher noen tildelt linje) hopper vi stille over —
 * resultatet blir et "konsekvens uten effekt", noe revert-pathen kommer
 * til å speile.
 */
async function applyConsequencesToBudget(
  sb: ReturnType<typeof getSupabaseAdmin>,
  order: ChangeOrder,
) {
  const { data: consequenceLines } = await sb
    .from('change_order_consequence_lines')
    .select('*')
    .eq('change_order_id', order.id)
  const lines = (consequenceLines ?? []) as ChangeOrderConsequenceLine[]
  for (const line of lines) {
    const { data: budgetLine } = await sb
      .from('project_budget_lines')
      .select('*')
      .eq('project_id', order.project_id)
      .eq('product_id', line.product_id)
      .eq('assigned_subcontractor_id', order.subcontractor_id)
      .maybeSingle<ProjectBudgetLine>()
    if (!budgetLine) continue
    const newQty = budgetLine.budget_quantity - line.quantity
    if (newQty <= 0) {
      await sb.from('project_budget_lines').delete().eq('id', budgetLine.id)
    } else {
      await sb.from('project_budget_lines').update({ budget_quantity: newQty }).eq('id', budgetLine.id)
    }
  }
}

/**
 * Inverse av applyConsequencesToBudget — brukes når et avslag angres
 * (rejected → pending). Legger konsekvens-mengdene tilbake i
 * prosjektbudsjettet. Hvis budsjettlinjen ble fullstendig slettet under
 * avslag-handlingen re-insertes den fra snapshots på konsekvens-linjen.
 */
async function reverseConsequencesOnBudget(
  sb: ReturnType<typeof getSupabaseAdmin>,
  order: ChangeOrder,
) {
  const { data: consequenceLines } = await sb
    .from('change_order_consequence_lines')
    .select('*')
    .eq('change_order_id', order.id)
  const lines = (consequenceLines ?? []) as ChangeOrderConsequenceLine[]
  for (const line of lines) {
    const { data: budgetLine } = await sb
      .from('project_budget_lines')
      .select('*')
      .eq('project_id', order.project_id)
      .eq('product_id', line.product_id)
      .eq('assigned_subcontractor_id', order.subcontractor_id)
      .maybeSingle<ProjectBudgetLine>()
    if (budgetLine) {
      await sb.from('project_budget_lines').update({
        budget_quantity: budgetLine.budget_quantity + line.quantity,
      }).eq('id', budgetLine.id)
    } else {
      const restored: ProjectBudgetLine = {
        id: randomUUID(),
        project_id: order.project_id,
        product_id: line.product_id,
        budget_quantity: line.quantity,
        customer_price_snapshot: line.customer_price_snapshot,
        assigned_subcontractor_id: order.subcontractor_id,
        subcontractor_cost_price_snapshot: line.cost_price_snapshot,
        source: 'manual',
      }
      await sb.from('project_budget_lines').insert(restored)
    }
  }
}

/**
 * Append an audit row directly instead of reading the whole table, mutating
 * the array, and writing the whole thing back. Concurrent calls now compose
 * safely — Postgres serializes the inserts.
 */
async function logActivity(
  entityId: string,
  action: ActivityEntry['action'],
  actor: string,
  comment?: string,
): Promise<void> {
  await getSupabaseAdmin().from('activity_log').insert({
    id: randomUUID(),
    entity_type: 'change_order',
    entity_id: entityId,
    action,
    actor,
    comment,
    created_at: new Date().toISOString(),
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { status, admin_comment } = await request.json() as {
    status: 'approved' | 'rejected' | 'pending'
    admin_comment?: string
  }
  if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
    return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()

  // Read the order first so we can branch on prev-status (for revert).
  const { data: order, error: readErr } = await sb
    .from('change_orders')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<ChangeOrder>()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const denied = await ensureProjectWritable(auth.user, order.project_id)
  if (denied) return denied

  const actor = auth.user.full_name
  const now = new Date().toISOString()

  if (status === 'pending') {
    // Revert: undo a previous approval/rejection.
    const prevStatus = order.status

    const { data: updated, error: updErr } = await sb
      .from('change_orders')
      .update({
        status: 'pending',
        admin_comment: null,
        reviewed_at: null,
        reviewed_by: null,
        // Reverting wipes the customer-review state too — admin starts fresh.
        sent_to_customer_at: null,
      })
      .eq('id', params.id)
      .select()
      .maybeSingle<ChangeOrder>()
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    if (prevStatus === 'approved') {
      // Reverse the budget effect: find the line this change-order created,
      // subtract the qty, drop the line if it falls to zero.
      const { data: existing } = await sb
        .from('project_budget_lines')
        .select('*')
        .eq('project_id', order.project_id)
        .eq('product_id', order.product_id)
        .eq('assigned_subcontractor_id', order.subcontractor_id)
        .maybeSingle<ProjectBudgetLine>()

      if (existing) {
        const newQty = existing.budget_quantity - order.requested_quantity
        if (newQty <= 0) {
          await sb.from('project_budget_lines').delete().eq('id', existing.id)
        } else {
          await sb.from('project_budget_lines').update({ budget_quantity: newQty }).eq('id', existing.id)
        }
      }
    } else if (prevStatus === 'rejected') {
      // Avslaget aktiverte konsekvens-linjene — angre må reversere dem så
      // budsjettet kommer tilbake til pre-avslag tilstand.
      await reverseConsequencesOnBudget(sb, order)
    }

    await logActivity(params.id, 'reverted', actor, admin_comment)
    return NextResponse.json(updated)
  }

  // Approve or reject.
  const { data: updated, error: updErr } = await sb
    .from('change_orders')
    .update({
      status,
      admin_comment: admin_comment ?? null,
      reviewed_at: now,
      reviewed_by: actor,
      // Once approved/rejected the sent-to-customer flag is meaningless.
      sent_to_customer_at: null,
    })
    .eq('id', params.id)
    .select()
    .maybeSingle<ChangeOrder>()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  if (status === 'approved') {
    // Apply the change to the project budget. Either bump an existing line or
    // insert a new one tagged source='change_order'.
    const { data: existing } = await sb
      .from('project_budget_lines')
      .select('*')
      .eq('project_id', order.project_id)
      .eq('product_id', order.product_id)
      .eq('assigned_subcontractor_id', order.subcontractor_id)
      .maybeSingle<ProjectBudgetLine>()

    if (existing) {
      await sb.from('project_budget_lines').update({
        budget_quantity: existing.budget_quantity + order.requested_quantity,
      }).eq('id', existing.id)
    } else {
      const newLine: ProjectBudgetLine = {
        id: randomUUID(),
        project_id: order.project_id,
        product_id: order.product_id,
        budget_quantity: order.requested_quantity,
        customer_price_snapshot: order.customer_price_snapshot,
        assigned_subcontractor_id: order.subcontractor_id,
        subcontractor_cost_price_snapshot: order.cost_price_snapshot,
        source: 'change_order',
      }
      await sb.from('project_budget_lines').insert(newLine)
    }

    // Defensive: ensure the UE is linked to the project so they can see it.
    // Check first, then insert — could race in theory, but the unique index
    // on (project_id, subcontractor_id) (if present) makes a dup harmless.
    const { data: linkExists } = await sb
      .from('project_subcontractors')
      .select('id')
      .eq('project_id', order.project_id)
      .eq('subcontractor_id', order.subcontractor_id)
      .maybeSingle()

    if (!linkExists) {
      await sb.from('project_subcontractors').insert({
        id: randomUUID(),
        project_id: order.project_id,
        subcontractor_id: order.subcontractor_id,
      })
    }
  } else if (status === 'rejected') {
    // Konsekvenser av avslag: trekk produktmengdene fra prosjektbudsjettet.
    // Hvis admin la inn "50 m² standardfliser" som konsekvens, fjernes nå
    // den mengden fra UE-ens budsjettlinje.
    await applyConsequencesToBudget(sb, order)
  }

  await logActivity(params.id, status === 'approved' ? 'approved' : 'rejected', actor, admin_comment)
  return NextResponse.json(updated)
}
