import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectBudgetLine } from '@/types'

/**
 * POST /api/budget-lines/merge-duplicates  { project_id }
 *
 * Slår sammen HELT IDENTISKE budsjettlinjer til ÉN linje med summert mengde.
 * Identitet = samme produkt + kundepris + UE-kostpris + tildeling + custom_label
 * + line_type + fase. Da endrer INGEN tall seg (bare antall linjer går ned) —
 * salgsverdi/kost er Σ(mengde)×pris = uendret.
 *
 * Rører ALDRI prisperioder (samme produkt, ULIK pris) eller underprodukter (egen
 * custom_label) — kun rene duplikater.
 *
 * Rapport-/produksjons-data PÅ de identiske linjene re-pekes til survivor (trygt:
 * lik pris ⇒ samme verdi). Rapportlinjer konsolideres per rapport (én beholdes,
 * mengde summeres) for ikke å bryte unik-skranken (rapport, linje). Avledede
 * avstemmingslinjer ryddes (regenereres).
 */
type WRL = { id: string; weekly_report_id: string; project_budget_line_id: string; reported_quantity: number | null }

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  // product_id (valgfritt): slå sammen KUN duplikater for ett produkt (per-produkt-
  // merge inne på linja). Uten = alle produkter i prosjektet (global «slå sammen alt»).
  let body: { project_id?: string; product_id?: string }
  try {
    body = await request.json() as { project_id?: string; product_id?: string }
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 })
  }
  if (!body.project_id) return NextResponse.json({ error: 'project_id mangler' }, { status: 400 })

  const denied = await ensureProjectWritable(auth.user, body.project_id)
  if (denied) return denied

  const sb = getSupabaseAdmin()
  const { data: linesData, error: linesErr } = await sb
    .from('project_budget_lines')
    .select('*')
    .eq('project_id', body.project_id)
  if (linesErr) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let lines = (linesData ?? []) as ProjectBudgetLine[]
  if (body.product_id) lines = lines.filter((l) => l.product_id === body.product_id)
  if (lines.length === 0) return NextResponse.json({ merged: 0, removed: 0, skipped: 0 })

  // Full-identitets-nøkkel: alt som påvirker tallene + tagging må være likt.
  const key = (l: ProjectBudgetLine) => [
    l.product_id,
    l.customer_price_snapshot,
    l.subcontractor_cost_price_snapshot,
    l.assigned_subcontractor_id ?? '',
    (l.custom_label ?? '').trim(),
    l.line_type ?? 'subcontractor_work',
    l.phase_id ?? '',
  ].join('||')

  const groups = new Map<string, ProjectBudgetLine[]>()
  for (const l of lines) {
    const k = key(l)
    const arr = groups.get(k) ?? []
    arr.push(l)
    groups.set(k, arr)
  }

  let merged = 0
  let removed = 0
  for (const arr of Array.from(groups.values())) {
    if (arr.length < 2) continue

    const survivor = arr[0]
    const removeIds = arr.slice(1).map((l) => l.id)
    const allIds = [survivor.id, ...removeIds]

    // 1. Konsolider rapportlinjer: behold ÉN per rapport (på survivor), summer
    //    mengden. Slett de andre FØR re-peking så unik-skranken (rapport, linje)
    //    ikke brytes midtveis.
    const { data: wrlData } = await sb
      .from('weekly_report_lines')
      .select('id, weekly_report_id, project_budget_line_id, reported_quantity')
      .in('project_budget_line_id', allIds)
    const byReport = new Map<string, WRL[]>()
    for (const w of (wrlData ?? []) as WRL[]) {
      const a = byReport.get(w.weekly_report_id) ?? []
      a.push(w)
      byReport.set(w.weekly_report_id, a)
    }
    for (const grp of Array.from(byReport.values())) {
      if (grp.length === 0) continue
      const sum = grp.reduce((s, w) => s + (Number(w.reported_quantity) || 0), 0)
      const keeper = grp.find((w) => w.project_budget_line_id === survivor.id) ?? grp[0]
      const dropIds = grp.filter((w) => w.id !== keeper.id).map((w) => w.id)
      if (dropIds.length > 0) {
        const { error } = await sb.from('weekly_report_lines').delete().in('id', dropIds)
        if (error) return NextResponse.json({ error: 'Rapportlinje-rydding feilet' }, { status: 500 })
      }
      const { error: upErr } = await sb
        .from('weekly_report_lines')
        .update({ project_budget_line_id: survivor.id, reported_quantity: sum })
        .eq('id', keeper.id)
      if (upErr) return NextResponse.json({ error: 'Rapportlinje-flytting feilet' }, { status: 500 })
    }

    // 2. Re-pek produksjonsføringer til survivor (lik pris ⇒ samme verdi).
    if (removeIds.length > 0) {
      await sb.from('project_production_entries')
        .update({ project_budget_line_id: survivor.id })
        .in('project_budget_line_id', removeIds)
    }

    // 3. Avledede avstemmingslinjer på de fjernede ryddes.
    await sb.from('project_reconciliation_lines').delete().in('project_budget_line_id', removeIds)

    // 4. Summer mengde inn i survivor + slett de andre budsjettlinjene.
    const newQty = arr.reduce((s, l) => s + (l.budget_quantity ?? 0), 0)
    const { error: updErr } = await sb
      .from('project_budget_lines')
      .update({ budget_quantity: newQty })
      .eq('id', survivor.id)
    if (updErr) return NextResponse.json({ error: 'Oppdatering feilet' }, { status: 500 })
    const { error: delErr } = await sb.from('project_budget_lines').delete().in('id', removeIds)
    if (delErr) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })

    merged++
    removed += removeIds.length
  }

  return NextResponse.json({ merged, removed, skipped: 0 })
}
