import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ProjectInvoice } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  let invoices = await readJson<ProjectInvoice>('project_invoices.json')
  if (projectId) invoices = invoices.filter((i) => i.project_id === projectId)
  return NextResponse.json(invoices)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Omit<ProjectInvoice, 'id' | 'created_at' | 'created_by'>
  const invoices = await readJson<ProjectInvoice>('project_invoices.json')
  const newInvoice: ProjectInvoice = {
    id: randomUUID(),
    project_id: body.project_id,
    amount: Number(body.amount),
    invoice_date: body.invoice_date,
    comment: body.comment ?? '',
    created_by: auth.user.full_name ?? 'Admin',
    created_at: new Date().toISOString(),
  }
  await writeJson('project_invoices.json', [...invoices, newInvoice])
  return NextResponse.json(newInvoice, { status: 201 })
}
