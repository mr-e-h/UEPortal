export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { resolveEffectiveSub } from '@/lib/tender'
import { getSubcontractorDashboard } from '@/lib/subcontractor-dashboard'

/**
 * Consolidated dashboard payload for one subcontractor. Replaces three
 * parallel fetches from the sub dashboard with one round trip and lets the
 * server do the joins/sums.
 *
 * The actual joins/sums live in lib/subcontractor-dashboard.ts so the RSC
 * dashboard page can reuse them server-side without an HTTP hop. This route
 * stays for the mobile quick-actions and sidebar badge clients that poll it.
 * Payload shape and values are unchanged.
 */
export async function GET(_request: NextRequest) {
  // UE-portal: subcontractor comes from the (effective) session, never the URL.
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const payload = await getSubcontractorDashboard(eff.subId)
  return NextResponse.json(payload)
}
