import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import { snapshotsAreEqual } from '@/lib/production-diff'
import type { ProductionEntry, ReconciliationLine, ProductionVersion, ProductionSnapshot, ProductionSnapshotLine } from '@/types'

/**
 * Batch-endepunkt for regneark-Avstemming (migrasjon 0019).
 *
 * PUT  /api/production-entries/batch   — skriv hele regnearket med én knapp
 * GET  /api/production-entries/batch?project_id=…  — hent versjonshistorikk
 *
 * ISOLASJON (absolutt):
 *   - requireAdmin: kun main / company / project_manager — ALDRI byggeleder/sub.
 *   - executed_by hardkodet = 'internal', subcontractor_id = null, cost = 0
 *     server-side. Ingen klientverdi kan overstyre disse.
 *   - Tabellen/ruten eksponeres ALDRI UE-side.
 *   - Snapshot lagrer KUN rå celler (ingen kundeverdi/kr).
 */

// ─── Hjelpere ─────────────────────────────────────────────────────────────────

interface BatchRow {
  project_budget_line_id: string
  product_id: string
  unit?: string
  quantity: number
  resolution?: string
  handled?: boolean
}

function validateRow(row: unknown, idx: number): { ok: true; row: BatchRow } | { ok: false; error: string } {
  if (typeof row !== 'object' || row == null) {
    return { ok: false, error: `Rad ${idx}: ugyldig format` }
  }
  const r = row as Record<string, unknown>

  if (typeof r.project_budget_line_id !== 'string' || !r.project_budget_line_id) {
    return { ok: false, error: `Rad ${idx}: project_budget_line_id mangler` }
  }
  if (typeof r.product_id !== 'string' || !r.product_id) {
    return { ok: false, error: `Rad ${idx}: product_id mangler` }
  }

  const qty = Number(r.quantity)
  if (!Number.isFinite(qty)) {
    return { ok: false, error: `Rad ${idx} (${r.project_budget_line_id}): mengde må være et gyldig tall` }
  }

  return {
    ok: true,
    row: {
      project_budget_line_id: r.project_budget_line_id as string,
      product_id: r.product_id as string,
      unit: typeof r.unit === 'string' ? r.unit : undefined,
      quantity: qty,
      resolution: typeof r.resolution === 'string' ? r.resolution : undefined,
      handled: typeof r.handled === 'boolean' ? r.handled : undefined,
    },
  }
}

// ─── GET — versjonshistorikk ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const projectId = new URL(request.url).searchParams.get('project_id')
  if (!projectId) {
    return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })
  }

  const { data, error } = await getSupabaseAdmin()
    .from('project_production_versions')
    .select('*')
    .eq('project_id', projectId)
    .order('taken_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as ProductionVersion[])
}

// ─── PUT — batch-lagring ───────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const body = await request.json() as {
    project_id?: string
    rows?: unknown[]
  }

  if (!body.project_id) {
    return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })
  }
  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ error: 'rows mangler eller er ikke en liste' }, { status: 400 })
  }

  // Skrive-port: PL kun på tildelte prosjekter.
  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  // Valider alle rader før vi skriver noe.
  const validatedRows: BatchRow[] = []
  for (let i = 0; i < body.rows.length; i++) {
    const result = validateRow(body.rows[i], i + 1)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    validatedRows.push(result.row)
  }

  const sb = getSupabaseAdmin()
  const projectId = body.project_id
  const now = new Date().toISOString()

  // ── Del 1: Egenprod-upsert / slett per rad ───────────────────────────────
  // executed_by = 'internal', subcontractor_id = null, cost = 0 hardkodet.
  // Unik delvis indeks: (project_id, project_budget_line_id, executed_by)
  // WHERE project_budget_line_id IS NOT NULL — den er alltid NOT NULL her.

  let upsertCount = 0
  let deleteCount = 0

  for (const row of validatedRows) {
    if (row.quantity > 0) {
      // Hent eksisterende internal-rad for dette prosjektet + budsjettlinje.
      const { data: existing } = await sb
        .from('project_production_entries')
        .select('id')
        .eq('project_id', projectId)
        .eq('project_budget_line_id', row.project_budget_line_id)
        .eq('executed_by', 'internal')
        .maybeSingle<Pick<ProductionEntry, 'id'>>()

      const entryId = existing?.id ?? randomUUID()

      // created_at utelates fra upsert-payloaden: DB-default (now()) gjelder ved
      // INSERT, og ved conflict-UPDATE forblir den opprinnelige tiden urørt
      // (Supabase oppdaterer kun feltene som er med i payloaden) — så
      // opprettelsestiden nullstilles ikke på hver «Lagre».
      const entry: Omit<ProductionEntry, 'created_at'> = {
        id: entryId,
        project_id: projectId,
        project_budget_line_id: row.project_budget_line_id,
        product_id: row.product_id,
        quantity: row.quantity,
        unit: row.unit ?? 'stk',
        // ISOLASJON: disse tre er alltid hardkodet — klientverdi ignoreres.
        executed_by: 'internal',
        subcontractor_id: null,
        cost: 0,
        comment: '',
        created_by: auth.user.id,
      }

      const { error: upsertErr } = await sb
        .from('project_production_entries')
        .upsert(entry, { onConflict: 'project_id,project_budget_line_id,executed_by' })

      if (upsertErr) {
        return NextResponse.json(
          { error: `Upsert feilet for linje ${row.project_budget_line_id}: ${upsertErr.message}` },
          { status: 500 },
        )
      }
      upsertCount++
    } else {
      // quantity = 0: slett eksisterende internal-rad (etterlat ikke 0-rader).
      const { error: delErr } = await sb
        .from('project_production_entries')
        .delete()
        .eq('project_id', projectId)
        .eq('project_budget_line_id', row.project_budget_line_id)
        .eq('executed_by', 'internal')

      if (delErr) {
        return NextResponse.json(
          { error: `Sletting feilet for linje ${row.project_budget_line_id}: ${delErr.message}` },
          { status: 500 },
        )
      }
      deleteCount++
    }
  }

  // ── Del 2: Recon-upsert (resolution / handled) ───────────────────────────
  // Kjøres kun for rader der resolution eller handled er eksplisitt sendt.
  // Gjenbruker logikken fra /api/reconciliation-lines PUT.

  for (const row of validatedRows) {
    const hasRecon = row.resolution !== undefined || row.handled !== undefined
    if (!hasRecon) continue

    // Les eksisterende recon-linje for å bevare felt som ikke endres.
    const { data: existing, error: readErr } = await sb
      .from('project_reconciliation_lines')
      .select('*')
      .eq('project_id', projectId)
      .eq('project_budget_line_id', row.project_budget_line_id)
      .maybeSingle<ReconciliationLine>()

    if (readErr) {
      return NextResponse.json({ error: 'Henting av avstemmingslinje feilet' }, { status: 500 })
    }

    const resolution = row.resolution !== undefined
      ? String(row.resolution)
      : (existing?.resolution ?? '')

    let handled = existing?.handled ?? false
    let handledBy = existing?.handled_by ?? null
    let handledAt = existing?.handled_at ?? null

    if (row.handled !== undefined) {
      handled = !!row.handled
      if (handled) {
        handledBy = auth.user.id
        handledAt = now
      } else {
        handledBy = null
        handledAt = null
      }
    }

    const reconRow: ReconciliationLine = {
      id: existing?.id ?? randomUUID(),
      project_id: projectId,
      project_budget_line_id: row.project_budget_line_id,
      product_id: row.product_id,
      // Bevarer eksisterende snapshot-mengder (planlagt/utført/diff) — batch-ruten
      // endrer kun egenprod-mengde og saksbehandlingsfelt, ikke planlagte verdier.
      planned_quantity: existing?.planned_quantity ?? null,
      executed_ue_quantity: existing?.executed_ue_quantity ?? null,
      // Speil produksjonsradens sannhet: når egenprod settes til 0 slettes
      // produksjonsraden (Del 1), så recon-kolonnen må nullstilles — ikke falle
      // tilbake til den gamle verdien (ellers divergerer den fra faktisk egenprod).
      executed_no_cost_quantity: row.quantity > 0 ? row.quantity : null,
      diff_quantity: existing?.diff_quantity ?? null,
      diff_customer_value: existing?.diff_customer_value ?? null,
      resolution,
      handled,
      handled_by: handledBy,
      handled_at: handledAt,
    }

    const { error: reconErr } = await sb
      .from('project_reconciliation_lines')
      .upsert(reconRow, { onConflict: 'project_id,project_budget_line_id' })

    if (reconErr) {
      return NextResponse.json(
        { error: `Recon-upsert feilet for linje ${row.project_budget_line_id}: ${reconErr.message}` },
        { status: 500 },
      )
    }
  }

  // ── Del 3: Snapshot — bygg ny versjon og lagre hvis endret ───────────────
  // Hent nåværende tilstand for alle linjer sendt i batch.
  // Snapshot inneholder KUN rå celler — ingen kundeverdi/kr.

  const budgetLineIds = validatedRows.map((r) => r.project_budget_line_id)

  const [peRes, rcRes] = await Promise.all([
    sb
      .from('project_production_entries')
      .select('project_budget_line_id, product_id, quantity')
      .eq('project_id', projectId)
      .eq('executed_by', 'internal')
      .in('project_budget_line_id', budgetLineIds),
    sb
      .from('project_reconciliation_lines')
      .select('project_budget_line_id, executed_no_cost_quantity, resolution, handled')
      .eq('project_id', projectId)
      .in('project_budget_line_id', budgetLineIds),
  ])

  const peMap = new Map<string, { quantity: number; product_id: string }>(
    ((peRes.data ?? []) as { project_budget_line_id: string; product_id: string; quantity: number }[])
      .map((e) => [e.project_budget_line_id, { quantity: e.quantity, product_id: e.product_id }]),
  )
  const rcMap = new Map<string, { executed_no_cost_quantity: number | null; resolution: string; handled: boolean }>(
    ((rcRes.data ?? []) as { project_budget_line_id: string; executed_no_cost_quantity: number | null; resolution: string; handled: boolean }[])
      .map((l) => [l.project_budget_line_id, l]),
  )

  const snapshotLines: ProductionSnapshotLine[] = validatedRows.map((row) => {
    const pe = peMap.get(row.project_budget_line_id)
    const rc = rcMap.get(row.project_budget_line_id)
    return {
      project_budget_line_id: row.project_budget_line_id,
      product_id: row.product_id,
      // Egenprod-mengden hentes fra produksjonsraden (sannhet) — IKKE fra recon-
      // raden, som kan bære en foreldet verdi. Slettet rad (qty=0) ⇒ pe mangler
      // ⇒ null, så nedstilling-til-0 fanges korrekt i historikk/diff.
      executed_no_cost_quantity: pe?.quantity ?? null,
      resolution: rc?.resolution ?? '',
      handled: rc?.handled ?? false,
    }
  })

  const newSnapshot: ProductionSnapshot = { lines: snapshotLines }

  // Hent siste versjon for dedup.
  const { data: lastVerData } = await sb
    .from('project_production_versions')
    .select('snapshot')
    .eq('project_id', projectId)
    .order('taken_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ snapshot: ProductionSnapshot }>()

  const lastSnapshot = lastVerData?.snapshot ?? null

  if (!snapshotsAreEqual(lastSnapshot, newSnapshot)) {
    const version: ProductionVersion = {
      id: randomUUID(),
      project_id: projectId,
      taken_at: now,
      // taken_by/taken_by_name settes ALLTID fra sesjon — aldri fra body.
      taken_by: auth.user.id,
      taken_by_name: auth.user.full_name ?? '',
      snapshot: newSnapshot,
      created_at: now,
    }

    const { error: verErr } = await sb
      .from('project_production_versions')
      .insert(version)

    if (verErr) {
      return NextResponse.json({ error: 'Versjon-lagring feilet' }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    upserted: upsertCount,
    deleted: deleteCount,
  })
}
