import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireUserAdmin } from '@/lib/api-guard'
import { monthlyPool } from '@/lib/resource-allocation'
import type { InternalHoursMonthly, InternalResource } from '@/types'

/**
 * Månedlig avstemming av faktisk internkost.
 *
 * Ressurspoolen (internal_resources) er bare et estimat. Her legges det totale
 * antallet interntimer som faktisk ble brukt en måned. Kosten regnes med
 * teamets snittkost (Σ kost ÷ Σ timer fra ressursene), snapshotet server-side
 * ved lagring så den er låst selv om ressursene endres senere. Fordelingen på
 * prosjekter skjer i Totaløkonomi (lib/resource-allocation.allocateActualInternalCost).
 *
 * Company-wide økonomi → requireUserAdmin (main/company), likt internal-resources.
 */

function parseHours(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Teamets snittkost per time = Σ(timer/mnd × timeskost) ÷ Σ timer/mnd. */
async function blendedHourlyCost(): Promise<number> {
  const { data } = await getSupabaseAdmin()
    .from('internal_resources')
    .select('hours_per_month, hourly_cost')
  const resources = (data ?? []) as Pick<InternalResource, 'hours_per_month' | 'hourly_cost'>[]
  const pool = monthlyPool(resources)
  return pool.hoursPerMonth > 0 ? pool.costPerMonth / pool.hoursPerMonth : 0
}

export async function GET() {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('internal_hours_monthly')
    .select('*')
    .order('year', { ascending: true })
    .order('month', { ascending: true })
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as InternalHoursMonthly[])
}

export async function PUT(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { year?: unknown; month?: unknown; total_hours?: unknown }
  const year = Number(body.year)
  const month = Number(body.month)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Ugyldig år' }, { status: 400 })
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Ugyldig måned' }, { status: 400 })
  }
  const totalHours = parseHours(body.total_hours)
  if (totalHours === null) return NextResponse.json({ error: 'Ugyldig timeantall' }, { status: 400 })

  const hourlyCostSnapshot = await blendedHourlyCost()
  const { data, error } = await getSupabaseAdmin()
    .from('internal_hours_monthly')
    .upsert(
      { year, month, total_hours: totalHours, hourly_cost_snapshot: hourlyCostSnapshot, updated_at: new Date().toISOString() },
      { onConflict: 'year,month' },
    )
    .select()
    .maybeSingle<InternalHoursMonthly>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const year = Number(url.searchParams.get('year'))
  const month = Number(url.searchParams.get('month'))
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return NextResponse.json({ error: 'year og month mangler' }, { status: 400 })
  }
  const { error } = await getSupabaseAdmin()
    .from('internal_hours_monthly')
    .delete()
    .eq('year', year)
    .eq('month', month)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
