import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, getProjectScope } from '@/lib/api-guard'
import type { Project } from '@/types'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('projects')
    .select('*')
    .eq('deleted', true)
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let projects = (data ?? []) as Project[]

  // PM scope: only see trashed projects you were assigned to.
  const scope = await getProjectScope(auth.user)
  if (scope) projects = projects.filter((p) => scope.has(p.id))

  return NextResponse.json(projects)
}
