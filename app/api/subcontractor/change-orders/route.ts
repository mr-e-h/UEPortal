export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { readJson, getDeletedProjectIds } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin } from '@/lib/api-guard'
import type { ChangeOrder } from '@/types'

export type UEChangeOrder = Omit<ChangeOrder, 'customer_price_snapshot' | 'total_customer_value' | 'profit'>

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const projectId = params.get('project_id')
  const requestedSubId = params.get('subcontractor_id')

  if (!requestedSubId) {
    return NextResponse.json({ error: 'subcontractor_id required' }, { status: 400 })
  }

  // Non-admin users can only access their own subcontractor data
  if (!isAdmin(session) && session.subcontractor_id !== requestedSubId) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const deletedProjectIds = getDeletedProjectIds()
  const orders = readJson<ChangeOrder>('change_orders.json')

  const safe: UEChangeOrder[] = orders
    .filter((o) => {
      if (deletedProjectIds.has(o.project_id)) return false
      if (o.subcontractor_id !== requestedSubId) return false
      if (projectId && o.project_id !== projectId) return false
      return true
    })
    .map(({ customer_price_snapshot: _cp, total_customer_value: _tcv, profit: _p, ...rest }) => rest)

  return NextResponse.json(safe)
}
