export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isAdmin } from '@/lib/api-guard'
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
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const requestedSubId = searchParams.get('subcontractor_id')

  if (!requestedSubId) return NextResponse.json({ error: 'subcontractor_id required' }, { status: 400 })

  // Non-admin users can only access their own data.
  if (!isAdmin(session) && session.subcontractor_id !== requestedSubId) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const projectId = searchParams.get('project_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const result = await getSubcontractorInvoiceBasis({
    subcontractorId: requestedSubId,
    projectId,
    from,
    to,
  })

  return NextResponse.json(result)
}
