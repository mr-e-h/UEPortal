import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { revalidateTag } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, requireAuth, isSub } from '@/lib/api-guard'
import { getCachedSubcontractors } from '@/lib/cache'
import type { Subcontractor } from '@/types'

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  // Read-mostly catalog — change orders rarely. 30s fresh + 60s stale-while-
  // revalidate is plenty for the assignment dropdowns and admin lists.
  const headers = { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' }

  // UE only ever sees their own row (used by /account etc).
  // Filter from the cached set so the full list never reaches a sub response.
  if (isSub(auth.user)) {
    if (!auth.user.subcontractor_id) return NextResponse.json([], { headers })
    const all = await getCachedSubcontractors()
    const own = all.filter((s) => s.id === auth.user.subcontractor_id)
    return NextResponse.json(own as Subcontractor[], { headers })
  }

  const all = await getCachedSubcontractors()
  return NextResponse.json(all as Subcontractor[], { headers })
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
  revalidateTag('subcontractors')
  return NextResponse.json(newSub, { status: 201 })
}
