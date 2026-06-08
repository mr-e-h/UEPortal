import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, getProjectScope } from '@/lib/api-guard'
import { getInvoiceBasis } from '@/lib/repos/invoice-basis'

/**
 * GET /api/invoice-basis — admin "Fakturagrunnlag".
 *
 * Thin route: authorize, parse filters, resolve PM scope, delegate to the
 * lib/repos/invoice-basis module (which owns the queries + assembly). The
 * response shape ({ lines, summary }) is unchanged.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const subcontractorId = searchParams.get('subcontractor_id')
  const from = searchParams.get('from') // ISO date string
  const to = searchParams.get('to')     // ISO date string
  const excludeBilled = searchParams.get('exclude_billed') !== 'false'

  // PM scope: a project_manager only sees fakturagrunnlag for their own
  // assigned projects. main / company / company-admin see everything (null).
  const scope = await getProjectScope(auth.user)

  const result = await getInvoiceBasis({
    projectId,
    subcontractorId,
    from,
    to,
    excludeBilled,
    scope,
  })

  return NextResponse.json(result)
}
