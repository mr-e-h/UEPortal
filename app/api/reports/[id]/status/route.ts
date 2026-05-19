import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { status } = await request.json() as { status: string }
  const reports = await readJson<{ id: string; [k: string]: unknown }>('reports.json')

  const idx = reports.findIndex((r) => r.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  reports[idx] = { ...reports[idx], status, updated_at: new Date().toISOString() }
  await writeJson('reports.json', reports)

  return NextResponse.json(reports[idx])
}
