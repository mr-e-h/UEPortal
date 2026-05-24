import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, getProjectScope, ensureProjectWritable } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ProjectInvoice } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('project_invoices').select('*')
  if (projectId) query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let invoices = (data ?? []) as ProjectInvoice[]

  const scope = await getProjectScope(auth.user)
  if (scope) invoices = invoices.filter((i) => scope.has(i.project_id))

  return NextResponse.json(invoices)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<Omit<ProjectInvoice, 'id' | 'created_at' | 'created_by'>>
  if (!body.project_id) {
    return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })
  }
  if (!body.invoice_date) {
    return NextResponse.json({ error: 'Fakturadato mangler' }, { status: 400 })
  }
  const amount = Number(body.amount)
  if (!Number.isFinite(amount)) {
    return NextResponse.json({ error: 'Ugyldig beløp' }, { status: 400 })
  }

  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const newInvoice: ProjectInvoice = {
    id: randomUUID(),
    project_id: body.project_id,
    amount,
    invoice_date: body.invoice_date,
    comment: body.comment ?? '',
    created_by: auth.user.full_name ?? 'Admin',
    created_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin().from('project_invoices').insert(newInvoice)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newInvoice, { status: 201 })
}
