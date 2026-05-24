export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { isAdmin } from '@/lib/api-guard'

type UEInvoice = {
  id: string
  subcontractor_id: string
  project_id: string | null
  amount: number
  invoice_date: string
  note: string
  created_at: string
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const requestedSubId = searchParams.get('subcontractor_id')
  if (!requestedSubId) return NextResponse.json({ error: 'subcontractor_id required' }, { status: 400 })
  if (!isAdmin(session) && session.subcontractor_id !== requestedSubId) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const projectId = searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('ue_invoices').select('*').eq('subcontractor_id', requestedSubId)
  if (projectId && projectId !== 'all') query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as UEInvoice[])
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const body = await request.json() as {
    subcontractor_id: string
    project_id?: string | null
    amount: number
    invoice_date: string
    note?: string
  }

  if (!body.subcontractor_id) return NextResponse.json({ error: 'subcontractor_id required' }, { status: 400 })
  if (!isAdmin(session) && session.subcontractor_id !== body.subcontractor_id) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Ugyldig beløp' }, { status: 400 })
  }

  const newInvoice: UEInvoice = {
    id: randomUUID(),
    subcontractor_id: body.subcontractor_id,
    project_id: body.project_id ?? null,
    amount,
    invoice_date: body.invoice_date || new Date().toISOString().split('T')[0],
    note: body.note ?? '',
    created_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin().from('ue_invoices').insert(newInvoice)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  return NextResponse.json(newInvoice)
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const requestedSubId = searchParams.get('subcontractor_id')
  if (!id || !requestedSubId) return NextResponse.json({ error: 'id and subcontractor_id required' }, { status: 400 })
  if (!isAdmin(session) && session.subcontractor_id !== requestedSubId) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  // Composite ownership check: only delete a row that matches BOTH id AND
  // subcontractor_id, so a UE can't delete another UE's invoice by guessing id.
  const { error, count } = await getSupabaseAdmin()
    .from('ue_invoices')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('subcontractor_id', requestedSubId)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
