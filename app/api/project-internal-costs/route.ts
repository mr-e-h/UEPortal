import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, getProjectScope, ensureProjectWritable } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ProjectInternalCostEntry } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('project_internal_costs').select('*')
  if (projectId) query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let entries = (data ?? []) as ProjectInternalCostEntry[]

  const scope = await getProjectScope(auth.user)
  if (scope) entries = entries.filter((e) => scope.has(e.project_id))

  return NextResponse.json(entries)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    project_id: string
    year: number
    month: number
    amount: number
    comment: string
  }
  if (!body.project_id) {
    return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })
  }
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: 'Beløp må være et ikke-negativt tall' }, { status: 400 })
  }
  const year = Number(body.year), month = Number(body.month)
  if (!Number.isInteger(year) || year < 2020 || year > 2040) {
    return NextResponse.json({ error: 'Ugyldig år' }, { status: 400 })
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Ugyldig måned' }, { status: 400 })
  }

  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const entry: ProjectInternalCostEntry = {
    id: randomUUID(),
    project_id: body.project_id,
    year, month, amount,
    comment: body.comment ?? '',
    created_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin().from('project_internal_costs').insert(entry)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(entry, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  // PM gate via the row's project. main/company pass straight through.
  const sb = getSupabaseAdmin()
  const { data: existing } = await sb
    .from('project_internal_costs')
    .select('project_id')
    .eq('id', id)
    .maybeSingle<{ project_id: string }>()
  if (existing) {
    const denied = await ensureProjectWritable(auth.user, existing.project_id)
    if (denied) return denied
  }

  const { error } = await sb.from('project_internal_costs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
