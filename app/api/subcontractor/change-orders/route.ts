export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { readJson, getDeletedProjectIds } from '@/lib/data'
import { resolveEffectiveSub } from '@/lib/tender'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { ChangeOrder } from '@/types'

/**
 * UE-safe EM: kundepris-feltene strippes (eksisterende mønster).
 * has_admin_edits og has_consequence_lines tilsettes etter beregning av
 * activity_log og change_order_consequence_lines for UEs egne EM-er — så
 * frontenden kan rendre 'Endret av prosjektleder'-badge og 'Har
 * konsekvens ved avslag'-indikator uten ekstra round-trips per rad.
 */
export type UEChangeOrder = Omit<ChangeOrder, 'customer_price_snapshot' | 'total_customer_value' | 'profit'> & {
  has_admin_edits: boolean
  has_consequence_lines: boolean
}

export async function GET(request: NextRequest) {
  // UE-portal: subcontractor comes from the (effective) session, never the URL.
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const projectId = new URL(request.url).searchParams.get('project_id')

  const deletedProjectIds = await getDeletedProjectIds()
  const orders = await readJson<ChangeOrder>('change_orders.json')

  const filtered = orders.filter((o) => {
    if (deletedProjectIds.has(o.project_id)) return false
    if (o.subcontractor_id !== eff.subId) return false
    if (projectId && o.project_id !== projectId) return false
    return true
  })

  // Bulk-sjekk hvilke EM-er som har 'edited'-rader fra admin/PL og hvilke
  // som har konsekvens-linjer. action='edited' skrives KUN av admin (UE
  // edits er 'submitted'/'resubmitted'), så vi trenger ikke filtrere på
  // actor. To round-trips totalt — bedre enn N+1 per rad.
  const ids = filtered.map((o) => o.id)
  let editedSet = new Set<string>()
  let conseqSet = new Set<string>()
  if (ids.length > 0) {
    const sb = getSupabaseAdmin()
    const [editedRes, conseqRes] = await Promise.all([
      sb.from('activity_log').select('entity_id')
        .eq('entity_type', 'change_order').eq('action', 'edited')
        .in('entity_id', ids),
      sb.from('change_order_consequence_lines').select('change_order_id')
        .in('change_order_id', ids),
    ])
    editedSet = new Set((editedRes.data ?? []).map((r: { entity_id: string }) => r.entity_id))
    conseqSet = new Set((conseqRes.data ?? []).map((r: { change_order_id: string }) => r.change_order_id))
  }

  const safe: UEChangeOrder[] = filtered.map(
    ({ customer_price_snapshot: _cp, total_customer_value: _tcv, profit: _p, ...rest }) => ({
      ...rest,
      has_admin_edits: editedSet.has(rest.id),
      has_consequence_lines: conseqSet.has(rest.id),
    }),
  )

  return NextResponse.json(safe)
}
