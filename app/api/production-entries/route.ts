import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getDeletedProjectIds } from '@/lib/data'
import {
  requireStaff,
  isSub,
  getProjectScope,
  isEmptyScope,
  ensureProjectWritable,
  canSeeCustomerEconomics,
} from '@/lib/api-guard'
import type { ProductionEntry, ProductionExecutedBy } from '@/types'

const EXECUTED_BY_VALUES: ProductionExecutedBy[] = ['subcontractor', 'internal', 'other']

/**
 * Produksjonsføringer (migrasjon 0018) — utført produksjon UTEN UE-kostnad
 * (egenprod/intern). Disse tabellene eksponeres ALDRI UE-side: subs får alltid
 * 403/tom. cost/verdi strippes for ikke-admin (canSeeCustomerEconomics).
 */

export async function GET(request: NextRequest) {
  // requireStaff slipper inn main/company/project_manager/byggeleder — men ALDRI
  // subs. Føringene er en intern-modul UE aldri ser.
  const auth = await requireStaff()
  if (!auth.ok) return auth.response
  // Belte-og-bukseseler: en sub skal aldri nå hit uansett (requireStaff utelater
  // SUB_ROLES), men hvis rollelisten endres er dette en eksplisitt sperre.
  if (isSub(auth.user)) return NextResponse.json([])

  const params = new URL(request.url).searchParams
  const projectId = params.get('project_id')

  const sb = getSupabaseAdmin()
  const query = sb.from('project_production_entries').select('*')
  if (projectId) query.eq('project_id', projectId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let entries = (data ?? []) as ProductionEntry[]

  const deletedProjectIds = await getDeletedProjectIds()
  entries = entries.filter((e) => !deletedProjectIds.has(e.project_id))

  // PM/byggeleder scope: kun tildelte prosjekter. main/company upåvirket (null).
  // Tomt scope ⇒ tom liste (ellers ville et tomt .in() lekke alt).
  const scope = await getProjectScope(auth.user)
  if (isEmptyScope(scope)) return NextResponse.json([])
  if (scope) entries = entries.filter((e) => scope.has(e.project_id))

  // Byggeleder ser ikke kundeøkonomi: strip cost (verdien per føring). main/
  // company/PM passerer urørt.
  if (!canSeeCustomerEconomics(auth.user)) {
    return NextResponse.json(entries.map((e) => ({ ...e, cost: 0 })))
  }

  return NextResponse.json(entries)
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff()
  if (!auth.ok) return auth.response
  if (isSub(auth.user)) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const body = await request.json() as {
    project_id?: string
    project_budget_line_id?: string | null
    product_id?: string
    quantity?: number
    unit?: string
    executed_by?: string
    subcontractor_id?: string | null
    cost?: number
    comment?: string
  }

  if (!body.project_id) return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })
  if (!body.product_id) return NextResponse.json({ error: 'product_id mangler' }, { status: 400 })

  // Skrive-port: PL/byggeleder kun på tildelte prosjekter (deltakere blokkeres).
  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const qty = Number(body.quantity)
  if (!Number.isFinite(qty) || qty < 0) {
    return NextResponse.json({ error: 'Mengde må være et ikke-negativt tall' }, { status: 400 })
  }

  if (!body.executed_by || !EXECUTED_BY_VALUES.includes(body.executed_by as ProductionExecutedBy)) {
    return NextResponse.json({ error: 'Ugyldig «utført av»' }, { status: 400 })
  }
  const executedBy = body.executed_by as ProductionExecutedBy

  // subcontractor_id er KUN gyldig når executed_by = 'subcontractor'. For
  // internal/other tvinges den til null så intern produksjon aldri feilaktig
  // tilskrives en UE.
  let subcontractorId: string | null = null
  if (executedBy === 'subcontractor') {
    if (!body.subcontractor_id) {
      return NextResponse.json(
        { error: 'Underentreprenør må velges når «utført av» er underentreprenør' },
        { status: 400 },
      )
    }
    subcontractorId = body.subcontractor_id
  } else if (body.subcontractor_id) {
    return NextResponse.json(
      { error: 'Underentreprenør kan kun settes når «utført av» er underentreprenør' },
      { status: 400 },
    )
  }

  // cost lagres alltid (v1: 0 kr = ordinær UE-kost). Ikke-negativt tall.
  const cost = body.cost == null ? 0 : Number(body.cost)
  if (!Number.isFinite(cost) || cost < 0) {
    return NextResponse.json({ error: 'Kost må være et ikke-negativt tall' }, { status: 400 })
  }

  const newEntry: ProductionEntry = {
    id: randomUUID(),
    project_id: body.project_id,
    project_budget_line_id: body.project_budget_line_id ?? null,
    product_id: body.product_id,
    quantity: qty,
    unit: body.unit ?? 'stk',
    executed_by: executedBy,
    subcontractor_id: subcontractorId,
    cost,
    comment: body.comment ?? '',
    created_by: auth.user.id,
    created_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin().from('project_production_entries').insert(newEntry)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  // cost strippes for ikke-admin i svaret, som i GET.
  if (!canSeeCustomerEconomics(auth.user)) {
    return NextResponse.json({ ...newEntry, cost: 0 }, { status: 201 })
  }
  return NextResponse.json(newEntry, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireStaff()
  if (!auth.ok) return auth.response
  if (isSub(auth.user)) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id mangler' }, { status: 400 })

  const sb = getSupabaseAdmin()
  const { data: entry, error: readErr } = await sb
    .from('project_production_entries')
    .select('project_id')
    .eq('id', id)
    .maybeSingle<Pick<ProductionEntry, 'project_id'>>()
  if (readErr) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  if (!entry) return NextResponse.json({ error: 'Føring ikke funnet' }, { status: 404 })

  // Skrive-port basert på føringens prosjekt.
  const denied = await ensureProjectWritable(auth.user, entry.project_id)
  if (denied) return denied

  const { error } = await sb.from('project_production_entries').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  return NextResponse.json({ success: true })
}
