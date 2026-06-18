export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { resolveEffectiveSub } from '@/lib/tender'

type UEInvoice = {
  id: string
  subcontractor_id: string
  project_id: string | null
  amount: number
  invoice_date: string
  note: string
  created_at: string
}

export async function GET(request: NextRequest) {
  // UE-portal: subcontractor comes from the (effective) session, never the URL.
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const sb = getSupabaseAdmin()
  const query = sb.from('ue_invoices').select('*').eq('subcontractor_id', eff.subId)
  if (projectId && projectId !== 'all') query.eq('project_id', projectId)
  // Date-range filter on invoice_date so the registered total can be scoped to
  // the same window as the invoice basis — without this, a date-filtered
  // "Gjenstår å fakturere" compares a windowed basis against ALL invoices.
  if (from) query.gte('invoice_date', from)
  if (to) query.lte('invoice_date', to)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as UEInvoice[])
}

export async function POST(request: NextRequest) {
  // UE-portal: the invoice is always filed for the caller's own sub — the
  // subcontractor_id is taken from the session, never trusted from the body.
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const body = await request.json() as {
    project_id?: string | null
    amount: number
    invoice_date: string
    note?: string
    line_ids?: string[]
    co_ids?: string[]
  }

  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Ugyldig beløp' }, { status: 400 })
  }

  // Optional: the report lines this invoice covers. We only ever touch lines
  // that belong to THIS sub (scoped via weekly_reports.subcontractor_id), so a
  // UE can't mark another UE's lines as billed by passing foreign ids.
  const lineIds = Array.isArray(body.line_ids)
    ? body.line_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []

  // Optional: the change orders (CO/EM) this invoice covers. Same protection as
  // lines, but ownership is read straight off change_orders.subcontractor_id —
  // a UE can only ever bill its OWN COs.
  const coIds = Array.isArray(body.co_ids)
    ? body.co_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []

  const sb = getSupabaseAdmin()

  // If the invoice covers specific report lines, resolve which of them are
  // actually this sub's own AND verify they belong to the invoice's project.
  //  - Ownership: weekly_report_lines -> weekly_reports.subcontractor_id (no
  //    subcontractor_id on the line itself), so a UE can't bill foreign lines.
  //  - Project: weekly_report_lines.project_budget_line_id ->
  //    project_budget_lines.project_id. Blocks billing project A's lines under a
  //    project-B invoice, which would skew per-project «Gjenstår» for both.
  let ownLineIds: string[] = []
  if (lineIds.length > 0) {
    const { data: ownReports } = await sb
      .from('weekly_reports')
      .select('id')
      .eq('subcontractor_id', eff.subId)
    const ownReportIds = (ownReports ?? []).map((r) => r.id as string)

    if (ownReportIds.length > 0) {
      const { data: ownLines } = await sb
        .from('weekly_report_lines')
        .select('id, project_budget_line_id')
        .in('id', lineIds)
        .in('weekly_report_id', ownReportIds)

      const blIds = Array.from(new Set((ownLines ?? []).map((l) => l.project_budget_line_id as string)))
      const projByBl = new Map<string, string>()
      if (blIds.length > 0) {
        const { data: bls } = await sb
          .from('project_budget_lines')
          .select('id, project_id')
          .in('id', blIds)
        for (const bl of bls ?? []) projByBl.set(bl.id as string, bl.project_id as string)
      }

      if (body.project_id) {
        const mismatch = (ownLines ?? []).some(
          (l) => projByBl.get(l.project_budget_line_id as string) !== body.project_id,
        )
        if (mismatch) {
          return NextResponse.json(
            { error: 'Valgte linjer tilhører et annet prosjekt enn fakturaen.' },
            { status: 400 },
          )
        }
      }
      ownLineIds = (ownLines ?? []).map((l) => l.id as string)
    }
  }

  // Resolve which of the requested COs are actually this sub's own AND (when the
  // invoice is project-scoped) belong to the invoice's project — same two guards
  // as for report lines, so a project-A CO can't be billed under a project-B
  // invoice. Ownership is the change_orders.subcontractor_id column itself.
  let ownCoIds: string[] = []
  if (coIds.length > 0) {
    let coQ = sb
      .from('change_orders')
      .select('id, project_id')
      .in('id', coIds)
      .eq('subcontractor_id', eff.subId)
    if (body.project_id) coQ = coQ.eq('project_id', body.project_id)
    const { data: ownCOs } = await coQ
    ownCoIds = (ownCOs ?? []).map((c) => c.id as string)
  }

  const newInvoice: UEInvoice = {
    id: randomUUID(),
    subcontractor_id: eff.subId,
    project_id: body.project_id ?? null,
    amount,
    invoice_date: body.invoice_date || new Date().toISOString().split('T')[0],
    note: body.note ?? '',
    created_at: new Date().toISOString(),
  }
  const { error } = await sb.from('ue_invoices').insert(newInvoice)
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  // Mark the validated own lines billed + link them to this invoice.
  const billedAt = new Date().toISOString()
  if (ownLineIds.length > 0) {
    await sb
      .from('weekly_report_lines')
      .update({ billed_at: billedAt, ue_invoice_id: newInvoice.id })
      .in('id', ownLineIds)
  }

  // Same for the validated own COs (mirrors the report-line marking; 0017 added
  // billed_at + ue_invoice_id to change_orders).
  if (ownCoIds.length > 0) {
    await sb
      .from('change_orders')
      .update({ billed_at: billedAt, ue_invoice_id: newInvoice.id })
      .in('id', ownCoIds)
  }

  return NextResponse.json(newInvoice)
}

export async function DELETE(request: NextRequest) {
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const sb = getSupabaseAdmin()

  // Composite ownership check: only operate on a row that matches BOTH id AND
  // the caller's own subcontractor_id, so a UE can't delete another UE's
  // invoice by guessing id.
  const { data: owned } = await sb
    .from('ue_invoices')
    .select('id')
    .eq('id', id)
    .eq('subcontractor_id', eff.subId)
    .maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  // Un-bill the lines this invoice covered BEFORE deleting it, so they reappear
  // in the basis. This must run first: the FK is ON DELETE SET NULL, so once
  // the invoice is gone the lines' ue_invoice_id is already null and there is
  // nothing left to match on (and billed_at — not part of the FK — would stay
  // set). We match on ue_invoice_id, which is only ever set to this sub's own
  // invoice ids, so no foreign lines can be touched.
  await sb
    .from('weekly_report_lines')
    .update({ billed_at: null, ue_invoice_id: null })
    .eq('ue_invoice_id', id)

  // Same un-billing for the COs this invoice covered — same ordering rationale
  // (ON DELETE SET NULL on change_orders.ue_invoice_id) and same scoping
  // (ue_invoice_id is only ever set to this sub's own invoice ids).
  await sb
    .from('change_orders')
    .update({ billed_at: null, ue_invoice_id: null })
    .eq('ue_invoice_id', id)

  const { error } = await sb
    .from('ue_invoices')
    .delete()
    .eq('id', id)
    .eq('subcontractor_id', eff.subId)
  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
