export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { resolveEffectiveSub } from '@/lib/tender'

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
  // UE-portal: subcontractor comes from the (effective) session, never the URL.
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const projectId = new URL(request.url).searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('ue_invoices').select('*').eq('subcontractor_id', eff.subId)
  if (projectId && projectId !== 'all') query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as UEInvoice[])
}

export async function POST(request: NextRequest) {
  // UE-portal: the invoice is always filed for the caller's own sub — the
  // subcontractor_id is taken from the session, never trusted from the body.
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const body = await request.json() as {
    project_id?: string | null
    amount: number
    invoice_date: string
    note?: string
  }

  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Ugyldig beløp' }, { status: 400 })
  }

  const newInvoice: UEInvoice = {
    id: randomUUID(),
    subcontractor_id: eff.subId,
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
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Composite ownership check: only delete a row that matches BOTH id AND the
  // caller's own subcontractor_id, so a UE can't delete another UE's invoice
  // by guessing id.
  const { error, count } = await getSupabaseAdmin()
    .from('ue_invoices')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('subcontractor_id', eff.subId)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
