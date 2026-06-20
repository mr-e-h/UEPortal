import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getDeletedProjectIds } from '@/lib/data'
import {
  requireAdmin,
  getProjectScope,
  isEmptyScope,
  ensureProjectWritable,
} from '@/lib/api-guard'
import type { ReconciliationLine } from '@/types'

/**
 * Avstemmingslinjer (migrasjon 0018) — én rad per budsjettlinje, avstemmer
 * planlagt vs faktisk utført før prosjektavslutning mot kunde. ADMIN/PL-ONLY:
 * requireAdmin slipper inn main/company/project_manager (= canSeeCustomerEconomics)
 * men ALDRI byggeleder eller sub. Linjene bærer kundeverdi
 * (planned_quantity/diff_customer_value), så de er aldri synlige UE-side.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')

  const sb = getSupabaseAdmin()
  const query = sb.from('project_reconciliation_lines').select('*')
  if (projectId) query.eq('project_id', projectId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let lines = (data ?? []) as ReconciliationLine[]

  const deletedProjectIds = await getDeletedProjectIds()
  lines = lines.filter((l) => !deletedProjectIds.has(l.project_id))

  // PM-scope: kun tildelte prosjekter. main/company upåvirket (null). Tomt scope
  // ⇒ tom liste.
  const scope = await getProjectScope(auth.user)
  if (isEmptyScope(scope)) return NextResponse.json([])
  if (scope) lines = lines.filter((l) => scope.has(l.project_id))

  return NextResponse.json(lines)
}

/**
 * UPSERT på (project_id, project_budget_line_id). Avstemmingslinjer opprettes
 * ALDRI eksplisitt andre steder — derfor lager denne ruten raden ved første
 * lagring (kommentar/«behandlet») og oppdaterer den ved senere lagringer. Klienten
 * sender hele snapshot-bildet (planlagt/utført/diff) som alt er regnet i tabellen,
 * så raden er komplett uten en forutgående POST. Da virker kommentar/«behandlet»
 * og lukk-gaten kan rydde ubehandlede differanser.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    project_id?: string
    project_budget_line_id?: string
    product_id?: string
    planned_quantity?: number | null
    executed_ue_quantity?: number | null
    executed_no_cost_quantity?: number | null
    diff_quantity?: number | null
    diff_customer_value?: number | null
    resolution?: string
    handled?: boolean
  }

  if (!body.project_id) return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })
  if (!body.project_budget_line_id) return NextResponse.json({ error: 'project_budget_line_id mangler' }, { status: 400 })
  if (!body.product_id) return NextResponse.json({ error: 'product_id mangler' }, { status: 400 })

  // PM write-side gate basert på prosjektet føringen gjelder.
  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const sb = getSupabaseAdmin()

  // Eksisterende rad (om noen) — bevarer id + handled-stempel som ikke endres nå.
  const { data: existing, error: readErr } = await sb
    .from('project_reconciliation_lines')
    .select('*')
    .eq('project_id', body.project_id)
    .eq('project_budget_line_id', body.project_budget_line_id)
    .maybeSingle<ReconciliationLine>()
  if (readErr) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })

  // Snapshot-feltene: nullable numeric. undefined ⇒ behold eksisterende verdi (på
  // upsert må vi sende hele raden); eksplisitt null tillatt; ellers endelig tall.
  const snapshot: Record<string, number | null> = {}
  for (const field of [
    'planned_quantity',
    'executed_ue_quantity',
    'executed_no_cost_quantity',
    'diff_quantity',
    'diff_customer_value',
  ] as const) {
    if (body[field] !== undefined) {
      const v = body[field]
      if (v === null) {
        snapshot[field] = null
      } else {
        const n = Number(v)
        if (!Number.isFinite(n)) {
          return NextResponse.json({ error: `Ugyldig tall for ${field}` }, { status: 400 })
        }
        snapshot[field] = n
      }
    } else {
      snapshot[field] = existing?.[field] ?? null
    }
  }

  const resolution = body.resolution !== undefined ? String(body.resolution) : (existing?.resolution ?? '')

  // handled flippes med saksbehandler-stempel. Settes til true ⇒ stemple
  // handled_by/handled_at; til false ⇒ nullstill stemplene. Urørt ⇒ behold.
  let handled = existing?.handled ?? false
  let handledBy = existing?.handled_by ?? null
  let handledAt = existing?.handled_at ?? null
  if (body.handled !== undefined) {
    handled = !!body.handled
    if (handled) {
      handledBy = auth.user.id
      handledAt = new Date().toISOString()
    } else {
      handledBy = null
      handledAt = null
    }
  }

  const row: ReconciliationLine = {
    id: existing?.id ?? randomUUID(),
    project_id: body.project_id,
    project_budget_line_id: body.project_budget_line_id,
    product_id: body.product_id,
    planned_quantity: snapshot.planned_quantity,
    executed_ue_quantity: snapshot.executed_ue_quantity,
    executed_no_cost_quantity: snapshot.executed_no_cost_quantity,
    diff_quantity: snapshot.diff_quantity,
    diff_customer_value: snapshot.diff_customer_value,
    resolution,
    handled,
    handled_by: handledBy,
    handled_at: handledAt,
  }

  const { data, error } = await sb
    .from('project_reconciliation_lines')
    .upsert(row, { onConflict: 'project_id,project_budget_line_id' })
    .select()
    .maybeSingle<ReconciliationLine>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })
  return NextResponse.json(data)
}
