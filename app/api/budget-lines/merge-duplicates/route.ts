import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import type { ProjectBudgetLine } from '@/types'

/**
 * POST /api/budget-lines/merge-duplicates  { project_id }
 *
 * Slår sammen HELT IDENTISKE budsjettlinjer til ÉN linje med summert mengde.
 * Identitet = samme produkt + kundepris + UE-kostpris + tildeling + custom_label
 * + line_type + fase. Da endrer INGEN tall seg (bare antall linjer går ned).
 *
 * Rører ALDRI:
 *   - prisperioder (samme produkt, ULIK pris) — ville blandet pris og regnet feil
 *   - underprodukter (egen custom_label)
 * Grupper der MINST én linje har ukesrapport eller produksjon hoppes over (vern),
 * så ingenting blir foreldreløst.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body: { project_id?: string }
  try {
    body = await request.json() as { project_id?: string }
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
  const lines = (linesData ?? []) as ProjectBudgetLine[]
  if (lines.length === 0) return NextResponse.json({ merged: 0, removed: 0, skipped: 0 })

  // Aktive linjer (rapport/produksjon) — disse vernes mot sammenslåing.
  const lineIds = lines.map((l) => l.id)
  const [wrlRes, prodRes] = await Promise.all([
    sb.from('weekly_report_lines').select('project_budget_line_id').in('project_budget_line_id', lineIds),
    sb.from('project_production_entries').select('project_budget_line_id').eq('project_id', body.project_id),
  ])
  const activeIds = new Set<string>()
  for (const r of (wrlRes.data ?? []) as Array<{ project_budget_line_id: string }>) activeIds.add(r.project_budget_line_id)
  for (const r of (prodRes.data ?? []) as Array<{ project_budget_line_id: string | null }>) {
    if (r.project_budget_line_id) activeIds.add(r.project_budget_line_id)
  }

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
  let skipped = 0
  for (const arr of Array.from(groups.values())) {
    if (arr.length < 2) continue
    if (arr.some((l) => activeIds.has(l.id))) { skipped++; continue }

    const survivor = arr[0]
    const removeIds = arr.slice(1).map((l) => l.id)
    const newQty = arr.reduce((s, l) => s + (l.budget_quantity ?? 0), 0)

    const { error: updErr } = await sb
      .from('project_budget_lines')
      .update({ budget_quantity: newQty })
      .eq('id', survivor.id)
    if (updErr) return NextResponse.json({ error: 'Oppdatering feilet' }, { status: 500 })

    // Avledede avstemmingslinjer på de fjernede ryddes med.
    await sb.from('project_reconciliation_lines').delete().in('project_budget_line_id', removeIds)
    const { error: delErr } = await sb.from('project_budget_lines').delete().in('id', removeIds)
    if (delErr) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })

    merged++
    removed += removeIds.length
  }

  return NextResponse.json({ merged, removed, skipped })
}
