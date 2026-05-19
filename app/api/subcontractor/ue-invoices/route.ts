export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'

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
  const invoices = await readJson<UEInvoice>('ue_invoices.json')

  let result = invoices.filter((inv) => inv.subcontractor_id === requestedSubId)
  if (projectId && projectId !== 'all') {
    result = result.filter((inv) => inv.project_id === projectId)
  }

  return NextResponse.json(result)
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
  if (!body.amount || body.amount <= 0) {
    return NextResponse.json({ error: 'Ugyldig beløp' }, { status: 400 })
  }

  const invoices = await readJson<UEInvoice>('ue_invoices.json')
  const newInvoice: UEInvoice = {
    id: randomUUID(),
    subcontractor_id: body.subcontractor_id,
    project_id: body.project_id ?? null,
    amount: body.amount,
    invoice_date: body.invoice_date || new Date().toISOString().split('T')[0],
    note: body.note ?? '',
    created_at: new Date().toISOString(),
  }
  invoices.push(newInvoice)
  await writeJson('ue_invoices.json', invoices)

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

  const invoices = await readJson<UEInvoice>('ue_invoices.json')
  const idx = invoices.findIndex((inv) => inv.id === id && inv.subcontractor_id === requestedSubId)
  if (idx === -1) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  invoices.splice(idx, 1)
  await writeJson('ue_invoices.json', invoices)

  return NextResponse.json({ ok: true })
}
