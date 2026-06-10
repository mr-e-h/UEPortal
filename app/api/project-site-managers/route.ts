import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, requireUserAdmin } from '@/lib/api-guard'
import type { User } from '@/types'

type SiteManagerAssignment = {
  id: string
  project_id: string
  user_id: string
  assigned_at: string
  assigned_by: string | null
}

/**
 * Byggeleder ↔ project assignments — mirrors /api/project-managers exactly.
 * This is the table lib/api-guard.getProjectScope reads for the byggeleder
 * role, so WRITES are requireUserAdmin (main/company) only: anyone who can
 * write here can grant a byggeleder scope over any project. GET is open to
 * any admin for display in the project admin UI.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('project_site_managers').select('*')
  if (projectId) query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })

  const rows = (data ?? []) as SiteManagerAssignment[]
  if (rows.length === 0) return NextResponse.json([])

  // Hydrate with the assigned user's name + email for display.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)))
  const { data: users } = await sb
    .from('users')
    .select('id, full_name, email')
    .in('id', userIds)
  const userMap = new Map(
    ((users ?? []) as Pick<User, 'id' | 'full_name' | 'email'>[]).map((u) => [u.id, u]),
  )
  const enriched = rows.map((r) => ({
    ...r,
    user: userMap.get(r.user_id) ?? null,
  }))
  return NextResponse.json(enriched)
}

export async function POST(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { project_id?: string; user_id?: string }
  if (!body.project_id || !body.user_id) {
    return NextResponse.json({ error: 'project_id og user_id er påkrevd' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  // Idempotent: return existing assignment if already there.
  const { data: existing } = await sb
    .from('project_site_managers')
    .select('*')
    .eq('project_id', body.project_id)
    .eq('user_id', body.user_id)
    .maybeSingle<SiteManagerAssignment>()
  if (existing) return NextResponse.json(existing)

  // Only byggeleder users can be assigned — assigning admins is meaningless
  // (they see everything) and assigning UE/PM here would silently widen the
  // wrong role's scope.
  const { data: user } = await sb
    .from('users')
    .select('role')
    .eq('id', body.user_id)
    .maybeSingle<Pick<User, 'role'>>()
  if (!user) return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })
  if (user.role !== 'byggeleder') {
    return NextResponse.json(
      { error: 'Kun byggeleder-brukere kan tildeles til prosjekt her' },
      { status: 400 },
    )
  }

  const { data, error } = await sb
    .from('project_site_managers')
    .insert({
      project_id: body.project_id,
      user_id: body.user_id,
      assigned_by: auth.user.id,
    })
    .select()
    .maybeSingle<SiteManagerAssignment>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })
  const { error } = await getSupabaseAdmin().from('project_site_managers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
