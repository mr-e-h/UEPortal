import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub, getProjectScope, canSeeCustomerEconomics } from '@/lib/api-guard'
import { stripCustomerEconomicsLines } from '@/lib/economy-isolation'
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

  // Non-admin access: a UE may only see EMs it owns; a byggeleder may see EMs on
  // projects in their scope. Mirrors the main GET /api/change-orders/[id] gate
  // (byggeleder was previously 403'd here, so the admin EM-detail lost its
  // multi-line table + "Konsekvens ved avslag" block for site managers).
  if (!isAdmin(session)) {
    const { data: owner } = await sb
      .from('change_orders')
      .select('subcontractor_id, project_id')
      .eq('id', params.id)
      .maybeSingle<{ subcontractor_id: string; project_id: string }>()
    if (!owner) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    if (isSub(session)) {
      if (owner.subcontractor_id !== session.subcontractor_id) {
        return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
      }
    } else if (session.role === 'byggeleder') {
      const scope = await getProjectScope(session)
      if (!scope || !scope.has(owner.project_id)) {
        return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
      }
    } else {
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

  // Strip customer-side prices for every non-economy role (UE + byggeleder).
  // They still see qty, product, unit and the cost snapshot. Matches the main GET.
  if (!canSeeCustomerEconomics(session)) {
    lines = stripCustomerEconomicsLines(lines) as ChangeOrderLine[]
  }

  return NextResponse.json(lines)
}
