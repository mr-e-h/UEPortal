import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, requireStaff, getProjectScope, ensureProjectWritable } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ProjectSubcontractor } from '@/types'

export async function GET(request: NextRequest) {
  // Project staff incl. byggeleder — "which UEs are on my projects" is core
  // operational info (no prices in these rows). The scope filter below
  // confines PM and byggeleder to assigned projects; writes stay requireAdmin.
  const auth = await requireStaff()
  if (!auth.ok) return auth.response

  const params = new URL(request.url).searchParams
  const projectId = params.get('project_id')
  const subcontractorId = params.get('subcontractor_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('project_subcontractors').select('*')
  if (projectId) query.eq('project_id', projectId)
  if (subcontractorId) query.eq('subcontractor_id', subcontractorId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let links = (data ?? []) as ProjectSubcontractor[]

  const scope = await getProjectScope(auth.user)
  if (scope) links = links.filter((l) => scope.has(l.project_id))

  return NextResponse.json(links)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<Omit<ProjectSubcontractor, 'id'>>
  if (!body.project_id || !body.subcontractor_id) {
    return NextResponse.json({ error: 'project_id og subcontractor_id er påkrevd' }, { status: 400 })
  }

  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const sb = getSupabaseAdmin()
  // Idempotent: return the existing link if already present.
  const { data: existing } = await sb
    .from('project_subcontractors')
    .select('*')
    .eq('project_id', body.project_id)
    .eq('subcontractor_id', body.subcontractor_id)
    .maybeSingle<ProjectSubcontractor>()
  if (existing) return NextResponse.json(existing)

  const newLink: ProjectSubcontractor = {
    id: randomUUID(),
    project_id: body.project_id,
    subcontractor_id: body.subcontractor_id,
  }
  const { error } = await sb.from('project_subcontractors').insert(newLink)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newLink, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const { data: existing } = await sb
    .from('project_subcontractors')
    .select('project_id')
    .eq('id', id)
    .maybeSingle<{ project_id: string }>()
  if (existing) {
    const denied = await ensureProjectWritable(auth.user, existing.project_id)
    if (denied) return denied
  }

  const { error } = await sb.from('project_subcontractors').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
