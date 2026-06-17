import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectBudgetLineSubcontractor, ProjectBudgetLine, SubcontractorProductPrice } from '@/types'

/**
 * UE-ANDELER på en budsjettlinje — del ett produkt mellom flere UE (mengde +
 * kostpris + ansvar per UE). Kunden faktureres for hele linja; UE-kost =
 * Σ(andel.mengde × andel.kostpris). Se ØKONOMIMODELL.md / migrasjon 0015.
 *
 *   GET    ?project_id=  → alle andeler for prosjektets budsjettlinjer
 *   POST   { budget_line_id, subcontractor_id, quantity } → ny andel (snapshotter
 *          UE-ens kostpris for produktet)
 *   PUT    { id, quantity } → endre mengde på en andel
 *   DELETE ?id=          → fjern andel
 *
 * Alt admin-only (requireAdmin) + skrive-scope via linjas prosjekt.
 */

async function lineProjectId(sb: ReturnType<typeof getSupabaseAdmin>, budgetLineId: string) {
  const { data } = await sb
    .from('project_budget_lines')
    .select('id, project_id, product_id, subcontractor_cost_price_snapshot')
    .eq('id', budgetLineId)
    .maybeSingle<Pick<ProjectBudgetLine, 'id' | 'project_id' | 'product_id' | 'subcontractor_cost_price_snapshot'>>()
  return data ?? null
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const { data: lines } = await sb.from('project_budget_lines').select('id').eq('project_id', projectId)
  const lineIds = ((lines ?? []) as { id: string }[]).map((l) => l.id)
  if (lineIds.length === 0) return NextResponse.json([])

  const { data, error } = await sb
    .from('project_budget_line_subcontractors')
    .select('*')
    .in('budget_line_id', lineIds)
  if (error) return NextResponse.json([])
  return NextResponse.json((data ?? []) as ProjectBudgetLineSubcontractor[])
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { budget_line_id?: string; subcontractor_id?: string; quantity?: number }
  if (!body.budget_line_id || !body.subcontractor_id) {
    return NextResponse.json({ error: 'budget_line_id og subcontractor_id er påkrevd' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()
  const line = await lineProjectId(sb, body.budget_line_id)
  if (!line) return NextResponse.json({ error: 'Budsjettlinje ikke funnet' }, { status: 404 })
  const denied = await ensureProjectWritable(auth.user, line.project_id)
  if (denied) return denied

  // Snapshot UE-ens kostpris for produktet (samme kilde som budget-lines PUT);
  // fall tilbake til linjas eksisterende snapshot hvis UE mangler pris.
  const { data: price } = await sb
    .from('subcontractor_product_prices')
    .select('cost_price')
    .eq('subcontractor_id', body.subcontractor_id)
    .eq('product_id', line.product_id)
    .maybeSingle<Pick<SubcontractorProductPrice, 'cost_price'>>()
  const costPrice = price?.cost_price ?? line.subcontractor_cost_price_snapshot ?? 0

  const row: ProjectBudgetLineSubcontractor = {
    id: randomUUID(),
    budget_line_id: body.budget_line_id,
    subcontractor_id: body.subcontractor_id,
    quantity: Number(body.quantity) || 0,
    cost_price_snapshot: costPrice,
    created_at: new Date().toISOString(),
  }
  const { error } = await sb.from('project_budget_line_subcontractors').insert(row)
  if (error) return NextResponse.json({ error: 'Lagring feilet (finnes UE allerede på linja?)' }, { status: 400 })
  return NextResponse.json(row, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as { id?: string; quantity?: number }
  if (!body.id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const { data: share } = await sb
    .from('project_budget_line_subcontractors')
    .select('budget_line_id')
    .eq('id', body.id)
    .maybeSingle<{ budget_line_id: string }>()
  if (!share) return NextResponse.json({ error: 'Andel ikke funnet' }, { status: 404 })
  const line = await lineProjectId(sb, share.budget_line_id)
  if (line) {
    const denied = await ensureProjectWritable(auth.user, line.project_id)
    if (denied) return denied
  }

  const { data, error } = await sb
    .from('project_budget_line_subcontractors')
    .update({ quantity: Number(body.quantity) || 0 })
    .eq('id', body.id)
    .select()
    .maybeSingle<ProjectBudgetLineSubcontractor>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const { data: share } = await sb
    .from('project_budget_line_subcontractors')
    .select('budget_line_id')
    .eq('id', id)
    .maybeSingle<{ budget_line_id: string }>()
  if (share) {
    const line = await lineProjectId(sb, share.budget_line_id)
    if (line) {
      const denied = await ensureProjectWritable(auth.user, line.project_id)
      if (denied) return denied
    }
  }

  const { error } = await sb.from('project_budget_line_subcontractors').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
