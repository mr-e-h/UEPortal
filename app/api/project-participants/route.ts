import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, requireUserAdmin } from '@/lib/api-guard'
import type { User } from '@/types'

type ParticipantRow = { id: string; project_id: string; user_id: string; created_at: string }

/**
 * Interne deltakere (innsyn) på et prosjekt — i tillegg til den ENE
 * prosjektlederen og den ENE byggelederen. Speiler /api/project-managers:
 * GET er åpen for admin (visning); WRITES er requireUserAdmin (main/company)
 * fordi dette er en tabell getProjectScope leser — den som kan skrive her kan
 * gi seg selv (eller andre) innsyn i et hvilket som helst prosjekt. Deltakere
 * får KUN lese: getProjectWriteScope tar dem ikke med, så de kan ikke mutere.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('project_participants').select('*')
  if (projectId) query.eq('project_id', projectId)
  const { data, error } = await query
  // Tabell mangler (migrasjon 0010 ikke kjørt) → tom liste (myk fallback).
  if (error) return NextResponse.json([])

  const rows = (data ?? []) as ParticipantRow[]
  if (rows.length === 0) return NextResponse.json([])

  // Hydrer med brukerens navn/e-post/rolle for visning.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)))
  const { data: users } = await sb
    .from('users')
    .select('id, full_name, email, role')
    .in('id', userIds)
  const userMap = new Map(
    ((users ?? []) as Pick<User, 'id' | 'full_name' | 'email' | 'role'>[]).map((u) => [u.id, u]),
  )
  return NextResponse.json(rows.map((r) => ({ ...r, user: userMap.get(r.user_id) ?? null })))
}

export async function POST(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { project_id?: string; user_id?: string }
  if (!body.project_id || !body.user_id) {
    return NextResponse.json({ error: 'project_id og user_id er påkrevd' }, { status: 400 })
  }
  const sb = getSupabaseAdmin()

  // Kun interne prosjektledere/byggeledere kan være deltakere (innsyn).
  // main/company ser alt allerede; UE har egen tilgangsvei.
  const { data: user } = await sb
    .from('users')
    .select('role')
    .eq('id', body.user_id)
    .maybeSingle<Pick<User, 'role'>>()
  if (!user) return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })
  if (user.role !== 'project_manager' && user.role !== 'byggeleder') {
    return NextResponse.json(
      { error: 'Kun prosjektledere og byggeledere kan være deltakere' },
      { status: 400 },
    )
  }

  // Den som allerede er ansvarlig (PL eller byggeleder) trenger ikke være deltaker.
  const [{ data: pm }, { data: sm }] = await Promise.all([
    sb.from('project_managers').select('id').eq('project_id', body.project_id).eq('user_id', body.user_id).maybeSingle<{ id: string }>(),
    sb.from('project_site_managers').select('id').eq('project_id', body.project_id).eq('user_id', body.user_id).maybeSingle<{ id: string }>(),
  ])
  if (pm || sm) {
    return NextResponse.json(
      { error: 'Brukeren er allerede ansvarlig (PL/byggeleder) på prosjektet' },
      { status: 400 },
    )
  }

  // Idempotent: returnér eksisterende om allerede deltaker.
  const { data: existing } = await sb
    .from('project_participants')
    .select('*')
    .eq('project_id', body.project_id)
    .eq('user_id', body.user_id)
    .maybeSingle<ParticipantRow>()
  if (existing) return NextResponse.json(existing)

  const { data, error } = await sb
    .from('project_participants')
    .insert({ id: randomUUID(), project_id: body.project_id, user_id: body.user_id })
    .select()
    .maybeSingle<ParticipantRow>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })
  const { error } = await getSupabaseAdmin().from('project_participants').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
