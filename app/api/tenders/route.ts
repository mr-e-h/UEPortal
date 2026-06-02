import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, getProjectScope, ensureProjectWritable } from '@/lib/api-guard'
import { getDeletedProjectIds } from '@/lib/data'
import { randomUUID } from 'crypto'
import type { Tender, TenderLine } from '@/types'

/**
 * GET /api/tenders — list tenders for admin/PM.
 * PM-scoped: project_manager only sees tenders on their assigned projects.
 * Optional ?project_id= filter.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('tenders').select('*').order('created_at', { ascending: false })
  if (projectId) query.eq('project_id', projectId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let tenders = (data ?? []) as Tender[]

  // Hide tenders on soft-deleted projects.
  const deleted = await getDeletedProjectIds()
  tenders = tenders.filter((t) => !deleted.has(t.project_id))

  // PM scope.
  const scope = await getProjectScope(auth.user)
  if (scope) tenders = tenders.filter((t) => scope.has(t.project_id))

  return NextResponse.json(tenders)
}

type CreateBody = {
  project_id: string
  title?: string
  description?: string
  deadline_at?: string | null
  lines?: Array<{
    product_id?: string | null
    description?: string
    unit?: string
    quantity?: number
  }>
  subcontractor_ids?: string[]
}

/**
 * POST /api/tenders — create a draft tender with its lines + invited UEs.
 * The tender starts in 'draft'; a separate /send call publishes it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as CreateBody
  if (!body.project_id) {
    return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })
  }

  // PM write-side gate.
  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const sb = getSupabaseAdmin()

  // Validate project exists + not deleted.
  const { data: project } = await sb
    .from('projects')
    .select('id, deleted')
    .eq('id', body.project_id)
    .maybeSingle<{ id: string; deleted: boolean }>()
  if (!project || project.deleted) {
    return NextResponse.json({ error: 'Prosjekt ikke funnet' }, { status: 404 })
  }

  const tenderId = randomUUID()
  const now = new Date().toISOString()

  const tender: Tender = {
    id: tenderId,
    project_id: body.project_id,
    title: (body.title ?? '').trim(),
    description: (body.description ?? '').trim(),
    status: 'draft',
    deadline_at: body.deadline_at ?? null,
    current_round: 1,
    awarded_subcontractor_id: null,
    awarded_at: null,
    awarded_by: null,
    created_by: auth.user.full_name,
    created_at: now,
    updated_at: now,
  }
  const { error: tErr } = await sb.from('tenders').insert(tender)
  if (tErr) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  // Lines — keep only those with a positive quantity and either a product or
  // free-text description.
  const lines = (body.lines ?? [])
    .map((l, i) => ({
      id: randomUUID(),
      tender_id: tenderId,
      product_id: l.product_id ?? null,
      description: (l.description ?? '').trim(),
      unit: (l.unit ?? 'stk').trim() || 'stk',
      quantity: Number(l.quantity) || 0,
      sort_order: i,
      created_at: now,
    }))
    .filter((l) => l.quantity > 0 && (l.product_id || l.description))
  if (lines.length > 0) {
    const { error: lErr } = await sb.from('tender_lines').insert(lines)
    if (lErr) return NextResponse.json({ error: 'Lagring av linjer feilet' }, { status: 500 })
  }

  // Invitations — dedupe the requested subcontractor ids.
  const subIds = Array.from(new Set(body.subcontractor_ids ?? []))
  if (subIds.length > 0) {
    const invitations = subIds.map((sid) => ({
      id: randomUUID(),
      tender_id: tenderId,
      subcontractor_id: sid,
      status: 'invited' as const,
      round: 1,
      invited_at: now,
      opened_at: null,
      created_at: now,
    }))
    const { error: iErr } = await sb.from('tender_invitations').insert(invitations)
    if (iErr) return NextResponse.json({ error: 'Lagring av invitasjoner feilet' }, { status: 500 })
  }

  return NextResponse.json(
    { ...tender, lines: lines as TenderLine[], invitation_count: subIds.length },
    { status: 201 },
  )
}
