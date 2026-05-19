import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { ProjectInvoice } from '@/types'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const invoices = await readJson<ProjectInvoice>('project_invoices.json')
  const filtered = invoices.filter((i) => i.id !== params.id)
  if (filtered.length === invoices.length) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  await writeJson('project_invoices.json', filtered)
  return NextResponse.json({ ok: true })
}
