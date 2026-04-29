import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { HourEntry } from '@/types'

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const entries = readJson<HourEntry>('hour_entries.json')
  writeJson('hour_entries.json', entries.filter((e) => e.id !== params.id))
  return NextResponse.json({ ok: true })
}
