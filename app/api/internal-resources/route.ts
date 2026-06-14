import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireUserAdmin } from '@/lib/api-guard'
import type { InternalResource } from '@/types'

/**
 * The company-wide internal resource pool.
 *
 * Gated to requireUserAdmin (main/company) — NOT plain requireAdmin — because
 * this is portfolio-wide economics (internal hourly costs spread across every
 * active project). A project_manager is project-scoped and must not see or edit
 * the pool, so it is treated like the other company-level admin surfaces.
 */

function parseAmount(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export async function GET() {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('internal_resources')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as InternalResource[])
}

export async function POST(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { name?: string; hours_per_month?: unknown; hourly_cost?: unknown }
  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Navn er påkrevd' }, { status: 400 })
  const hoursPerMonth = parseAmount(body.hours_per_month)
  if (hoursPerMonth === null) return NextResponse.json({ error: 'Ugyldig timeantall' }, { status: 400 })
  const hourlyCost = parseAmount(body.hourly_cost)
  if (hourlyCost === null) return NextResponse.json({ error: 'Ugyldig timeskost' }, { status: 400 })

  const row: InternalResource = {
    id: randomUUID(),
    name,
    hours_per_month: hoursPerMonth,
    hourly_cost: hourlyCost,
    created_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin().from('internal_resources').insert(row)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(row, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { id?: string; name?: string; hours_per_month?: unknown; hourly_cost?: unknown }
  if (!body.id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: 'Navn er påkrevd' }, { status: 400 })
    updates.name = name
  }
  if (body.hours_per_month !== undefined) {
    const hoursPerMonth = parseAmount(body.hours_per_month)
    if (hoursPerMonth === null) return NextResponse.json({ error: 'Ugyldig timeantall' }, { status: 400 })
    updates.hours_per_month = hoursPerMonth
  }
  if (body.hourly_cost !== undefined) {
    const hourlyCost = parseAmount(body.hourly_cost)
    if (hourlyCost === null) return NextResponse.json({ error: 'Ugyldig timeskost' }, { status: 400 })
    updates.hourly_cost = hourlyCost
  }

  const { data, error } = await getSupabaseAdmin()
    .from('internal_resources')
    .update(updates)
    .eq('id', body.id)
    .select()
    .maybeSingle<InternalResource>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  const { error } = await getSupabaseAdmin().from('internal_resources').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
