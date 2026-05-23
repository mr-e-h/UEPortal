import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, requireAuth, isSub } from '@/lib/api-guard'
import type { Subcontractor } from '@/types'

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const sb = getSupabaseAdmin()
  // UE only ever sees their own row (used by /account etc).
  if (isSub(auth.user)) {
    if (!auth.user.subcontractor_id) return NextResponse.json([])
    const { data, error } = await sb
      .from('subcontractors')
      .select('*')
      .eq('id', auth.user.subcontractor_id)
    if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
    return NextResponse.json((data ?? []) as Subcontractor[])
  }

  const { data, error } = await sb.from('subcontractors').select('*')
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as Subcontractor[])
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as Partial<Omit<Subcontractor, 'id'>>
  if (!body.company_name?.trim()) {
    return NextResponse.json({ error: 'Firmanavn er påkrevd' }, { status: 400 })
  }

  const newSub: Subcontractor = {
    id: randomUUID(),
    company_name: body.company_name.trim(),
    contact_person: body.contact_person ?? '',
    email: body.email ?? '',
    phone: body.phone ?? '',
    organization_number: body.organization_number ?? '',
    county: body.county ?? '',
    active: body.active ?? true,
  }
  const { error } = await getSupabaseAdmin().from('subcontractors').insert(newSub)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(newSub, { status: 201 })
}
