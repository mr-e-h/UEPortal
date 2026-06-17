import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, requireUserAdmin } from '@/lib/api-guard'
import type { ProjectManagerAssignment, User } from '@/types'

/**
 * PM ↔ project assignments. Used to scope what each project_manager sees
 * (see lib/api-guard.getProjectScope). GET is open to any admin (main /
 * company / project_manager) for display. WRITES (POST/DELETE) are
 * restricted to requireUserAdmin (main / company): this IS the table that
 * getProjectScope reads, so allowing a project_manager to write here would
 * let a PM grant themselves scope over any project. Keep writes user-admin
 * only.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('project_managers').select('*')
  if (projectId) query.eq('project_id', projectId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })

  const rows = (data ?? []) as ProjectManagerAssignment[]
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
  // Reject if user is not a project_manager role — assigning main/company
  // is meaningless (they already see all projects) and could confuse the UI.
  // Valideres FØR vi muterer, så en ugyldig tildeling ikke fjerner dagens PL.
  const { data: user } = await sb
    .from('users')
    .select('role')
    .eq('id', body.user_id)
    .maybeSingle<Pick<User, 'role'>>()
  if (!user) return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })
  if (user.role !== 'project_manager') {
    return NextResponse.json(
      { error: 'Kun project_manager-brukere kan tildeles til prosjekt' },
      { status: 400 },
    )
  }

  // Nøyaktig ÉN prosjektleder per prosjekt: erstatt en evt. eksisterende.
  await sb.from('project_managers').delete().eq('project_id', body.project_id)

  const { data, error } = await sb
    .from('project_managers')
    .insert({
      project_id: body.project_id,
      user_id: body.user_id,
      assigned_by: auth.user.id,
    })
    .select()
    .maybeSingle<ProjectManagerAssignment>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })
  const { error } = await getSupabaseAdmin().from('project_managers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
