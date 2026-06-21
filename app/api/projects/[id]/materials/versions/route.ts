import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import type { ProjectMaterialVersion } from '@/types'

// ─── GET /api/projects/[id]/materials/versions ───────────────────────────────
// Returnerer alle snapshotversjoner for prosjektet, nyeste versjon først.
// Kun tilgjengelig for admin/PL — aldri UE-siden.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('project_material_versions')
    .select('*')
    .eq('project_id', params.id)
    .order('version', { ascending: false })

  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as ProjectMaterialVersion[])
}
