import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireStaff } from '@/lib/api-guard'
import type { PhaseType } from '@/components/admin/FremdriftsplanClient'

/**
 * GET /api/phase-types — aktive arbeidsfase-typer (Graving, Luftarbeid, ...).
 * Lesbar for alt prosjektpersonell inkl. byggeleder (ingen økonomi her).
 * Returnerer [] hvis tabellen ikke finnes ennå (0002 ikke kjørt) — samme
 * fallback-prinsipp som fremdriftsplan-siden.
 */
export async function GET() {
  const auth = await requireStaff()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('phase_types')
    .select('id, name, color, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) return NextResponse.json([])
  return NextResponse.json((data ?? []) as PhaseType[])
}
