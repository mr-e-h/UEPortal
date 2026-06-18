export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { resolveEffectiveSub } from '@/lib/tender'
import { getSubcontractorInvoiceBasis } from '@/lib/repos/invoice-basis'

/**
 * GET /api/subcontractor/invoice-basis — the UE's own invoice basis.
 *
 * Thin route: authenticate, enforce that the caller owns the requested
 * subcontractor_id (or is an admin), then delegate to the lib/repos module.
 * The response shape ({ lines, summary }) — cost side only, no customer price —
 * is unchanged. Access control is preserved verbatim.
 */
export async function GET(request: NextRequest) {
  // UE-portal: subcontractor comes from the (effective) session, never the URL.
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  // NB: the basis always returns the full approved set; every line — report
  // lines AND change orders (CO billed columns added in migration 0017) —
  // carries its own billed_at/ue_invoice_id status. «Skjul fakturerte» is a
  // client-side display filter only — there is no server-side excludeBilled
  // toggle here, so no new query params are needed.

  const result = await getSubcontractorInvoiceBasis({
    subcontractorId: eff.subId,
    projectId,
    from,
    to,
  })

  return NextResponse.json(result)
}
