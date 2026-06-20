import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub, getProjectScope, canSeeCustomerEconomics } from '@/lib/api-guard'
import { stripCustomerEconomicsLines } from '@/lib/economy-isolation'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { ChangeOrderConsequenceLine } from '@/types'

/**
 * Returner alle "konsekvens ved avslag"-linjene knyttet til en EM. Sortert
 * etter sort_order så admin-tabellen viser dem i tildelt rekkefølge.
 *
 * Tilgang:
 *   - Admin/PM: alle.
 *   - UE: bare EM-er de selv eier (samme regel som /lines-endepunktet).
 *
 * Konsekvens-linjer inneholder ikke kunde-priser i seg selv — de er
 * mengder + cost/customer-snapshots brukt til budsjett-justering. UE får
 * customer_price_snapshot strippet på samme måte som vanlige EM-linjer.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const sb = getSupabaseAdmin()

  // Tilgang: admin alle; UE bare egne EM-er; byggeleder EM-er på prosjekter i
  // sin scope. Speiler hoved-GET /api/change-orders/[id] (byggeleder ble før
  // 403'et her, så «Konsekvens ved avslag» forsvant for byggeleder).
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
    .from('change_order_consequence_lines')
    .select('*')
    .eq('change_order_id', params.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let lines = (data ?? []) as ChangeOrderConsequenceLine[]

  // Strip kundepris for alle ikke-økonomi-roller (UE + byggeleder), som hoved-GET.
  if (!canSeeCustomerEconomics(session)) {
    lines = stripCustomerEconomicsLines(lines) as ChangeOrderConsequenceLine[]
  }

  return NextResponse.json(lines)
}
