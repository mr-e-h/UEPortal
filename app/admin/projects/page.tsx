import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { ADMIN_ROLES, PROJECT_STAFF_ROLES } from '@/lib/roles'
import { getProjectScope } from '@/lib/api-guard'
import { EM_NEEDS_ACTION, WR_NEEDS_ACTION, attentionCounts } from '@/lib/attention'
import type { Project, ProjectBudgetLine, ProjectSubcontractor } from '@/types'
import Button from '@/components/ui/Button'
import ProjectsOverviewClient, { type ProjectCardData } from '@/components/admin/ProjectsOverviewClient'

export const dynamic = 'force-dynamic'

/**
 * Prosjektoversikt — kortvisning (default) med tabell som alternativ.
 *
 * Kort-innholdet er økonomifritt for byggeleder (navn, status, PL, UE-er,
 * datoer, volumfremdrift, ventende behandlinger). Omsetning vises kun for
 * økonomiroller (main/company/PM) — den beregnes og serialiseres ALDRI for
 * byggeleder. Scope-filteret avgrenser PM/byggeleder til tildelte prosjekter;
 * tom scope gir tom liste.
 */
export default async function ProjectsPage() {
  const me = await getSession()
  if (!me || !PROJECT_STAFF_ROLES.includes(me.role)) redirect('/login')
  // Creating projects stays an admin action (POST /api/projects is
  // requireAdmin) — hide the button for byggeleder.
  const canCreate = ADMIN_ROLES.includes(me.role)
  // Kundeøkonomi (omsetning) på kortene: kun admin-rollene (main/company/PM).
  // Byggeleder skal aldri se kundeøkonomi.
  const canSeeEconomy = ADMIN_ROLES.includes(me.role)

  const sb = getSupabaseAdmin()
  const scope = await getProjectScope(me)

  const [projRes, blRes, psRes, subsRes, pmLinksRes, pendingCORes, pendingWRRes, checklistRes] = await Promise.all([
    sb.from('projects').select('*').neq('deleted', true),
    sb.from('project_budget_lines').select('id, project_id, budget_quantity, customer_price_snapshot'),
    sb.from('project_subcontractors').select('project_id, subcontractor_id'),
    sb.from('subcontractors').select('id, company_name'),
    sb.from('project_managers').select('project_id, user_id'),
    sb.from('change_orders').select('project_id').in('status', [...EM_NEEDS_ACTION]),
    sb.from('weekly_reports').select('project_id').in('status', [...WR_NEEDS_ACTION]),
    sb.from('project_checklist_items').select('project_id').is('completed_at', null),
  ])

  let projects = (projRes.data ?? []) as Project[]
  if (scope) projects = projects.filter((p) => scope.has(p.id))

  const budgetLines = (blRes.data ?? []) as Pick<ProjectBudgetLine, 'id' | 'project_id' | 'budget_quantity' | 'customer_price_snapshot'>[]
  const projectSubs = (psRes.data ?? []) as Pick<ProjectSubcontractor, 'project_id' | 'subcontractor_id'>[]
  const subs = (subsRes.data ?? []) as Array<{ id: string; company_name: string }>
  const pmLinks = (pmLinksRes.data ?? []) as Array<{ project_id: string; user_id: string }>

  // PM-navn: slå opp brukerne som faktisk er tildelt (uavhengig av rolle).
  const pmUserIds = Array.from(new Set(pmLinks.map((l) => l.user_id)))
  const { data: pmUsersData } = pmUserIds.length > 0
    ? await sb.from('users').select('id, full_name').in('id', pmUserIds)
    : { data: [] as Array<{ id: string; full_name: string }> }
  const pmNameById = new Map(((pmUsersData ?? []) as Array<{ id: string; full_name: string }>).map((u) => [u.id, u.full_name]))

  // Godkjente rapporterte mengder per budsjettlinje → fremdrift per prosjekt.
  const blIds = budgetLines.map((bl) => bl.id)
  const { data: approvedLinesData, error: approvedLinesErr } = blIds.length > 0
    ? await sb.from('weekly_report_lines')
        .select('project_budget_line_id, reported_quantity')
        .eq('status', 'approved')
        .in('project_budget_line_id', blIds)
    : { data: [] as Array<{ project_budget_line_id: string; reported_quantity: number }>, error: null }
  if (approvedLinesErr) {
    // Fremdrift degraderer til tidsfallback ved feil — men logg årsaken så
    // den ikke forsvinner stille.
    console.error('projects/page approved-lines query failed:', approvedLinesErr.message)
  }
  const approvedLines = (approvedLinesData ?? []) as Array<{ project_budget_line_id: string; reported_quantity: number }>

  // ── Aggregeringer per prosjekt ──────────────────────────────────────────
  const subNameById = new Map(subs.map((s) => [s.id, s.company_name]))
  const blCounts: Record<string, number> = {}
  const linesByProject = new Map<string, Array<{ id: string; budget_quantity: number }>>()
  for (const bl of budgetLines) {
    blCounts[bl.project_id] = (blCounts[bl.project_id] ?? 0) + 1
    const arr = linesByProject.get(bl.project_id) ?? []
    arr.push({ id: bl.id, budget_quantity: bl.budget_quantity })
    linesByProject.set(bl.project_id, arr)
  }
  // Godkjent mengde PER budsjettlinje — fremdriften regnes som snitt av
  // per-linje-fullføring, ikke Σmengde/Σmengde. Rundsum-linjer (1 kr-produkter
  // der mengde ≈ kronebeløp) ville ellers druknet de reelle meterne/stykkene.
  const approvedQtyByLine = new Map<string, number>()
  for (const l of approvedLines) {
    approvedQtyByLine.set(
      l.project_budget_line_id,
      (approvedQtyByLine.get(l.project_budget_line_id) ?? 0) + l.reported_quantity,
    )
  }

  const subCounts: Record<string, number> = {}
  const subNamesByProject = new Map<string, string[]>()
  for (const ps of projectSubs) {
    subCounts[ps.project_id] = (subCounts[ps.project_id] ?? 0) + 1
    const name = subNameById.get(ps.subcontractor_id)
    if (!name) continue
    const arr = subNamesByProject.get(ps.project_id) ?? []
    arr.push(name)
    subNamesByProject.set(ps.project_id, arr)
  }

  const pmNamesByProject = new Map<string, string[]>()
  for (const link of pmLinks) {
    const name = pmNameById.get(link.user_id)
    if (!name) continue
    const arr = pmNamesByProject.get(link.project_id) ?? []
    arr.push(name)
    pmNamesByProject.set(link.project_id, arr)
  }

  const countBy = (rows: Array<{ project_id: string }>) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.project_id, (m.get(r.project_id) ?? 0) + 1)
    return m
  }
  const pendingCOByProject = countBy((pendingCORes.data ?? []) as Array<{ project_id: string }>)
  const pendingWRByProject = countBy((pendingWRRes.data ?? []) as Array<{ project_id: string }>)
  const openChecklistByProject = countBy((checklistRes.data ?? []) as Array<{ project_id: string }>)

  // Omsetning per prosjekt = total kontraktsverdi (budsjettets salgsverdi +
  // godkjente EM-er). KUN for økonomiroller — for byggeleder beregnes/serialiseres
  // dette aldri, så kundeøkonomi når aldri deres nettleser.
  const revenueByProject = new Map<string, number>()
  if (canSeeEconomy) {
    for (const bl of budgetLines) {
      const v = (bl.budget_quantity ?? 0) * (bl.customer_price_snapshot ?? 0)
      revenueByProject.set(bl.project_id, (revenueByProject.get(bl.project_id) ?? 0) + v)
    }
    const { data: emData } = await sb
      .from('change_orders')
      .select('project_id, total_customer_value')
      .eq('status', 'approved')
    for (const co of (emData ?? []) as Array<{ project_id: string; total_customer_value: number | null }>) {
      revenueByProject.set(co.project_id, (revenueByProject.get(co.project_id) ?? 0) + (co.total_customer_value ?? 0))
    }
  }

  // ── Kortdata (økonomifritt) ─────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]
  const cards: ProjectCardData[] = projects.map((p) => {
    // Fremdrift: enhetsagnostisk snitt av per-linje-fullføring —
    // mean(min(1, godkjent_i / budsjett_i)) over linjer med budsjett > 0.
    // Fallback: tidsbasert mellom start og slutt når budsjettlinjer mangler.
    const projLines = (linesByProject.get(p.id) ?? []).filter((l) => l.budget_quantity > 0)
    let progress: number | null = null
    let progressSource: 'volum' | 'tid' | null = null
    if (projLines.length > 0) {
      const ratioSum = projLines.reduce(
        (s, l) => s + Math.min(1, (approvedQtyByLine.get(l.id) ?? 0) / l.budget_quantity),
        0,
      )
      progress = Math.max(0, Math.min(100, Math.round((ratioSum / projLines.length) * 100)))
      progressSource = 'volum'
    } else if (p.start_date && p.end_date && p.end_date > p.start_date) {
      const total = Date.parse(p.end_date) - Date.parse(p.start_date)
      const gone = Date.parse(today) - Date.parse(p.start_date)
      progress = Math.max(0, Math.min(100, Math.round((gone / total) * 100)))
      progressSource = 'tid'
    }

    const pendingCO = pendingCOByProject.get(p.id) ?? 0
    const pendingWR = pendingWRByProject.get(p.id) ?? 0
    const openTasks = openChecklistByProject.get(p.id) ?? 0

    return {
      id: p.id,
      name: p.name,
      project_number: p.project_number,
      customer: p.customer,
      county: p.county,
      status: p.status,
      start_date: p.start_date,
      end_date: p.end_date,
      pm_names: pmNamesByProject.get(p.id) ?? [],
      sub_names: subNamesByProject.get(p.id) ?? [],
      progress,
      progress_source: progressSource,
      // null for byggeleder (ikke beregnet) → aldri i serialisert kortdata.
      revenue: canSeeEconomy ? (revenueByProject.get(p.id) ?? 0) : null,
      attention: attentionCounts({
        changeOrders: pendingCO,
        weeklyReports: pendingWR,
        openTasks,
      }),
    }
  })

  const active = projects.filter((p) => p.status === 'active')
  const rest = projects.filter((p) => p.status !== 'active')

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Prosjekter</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{active.length} aktive · {rest.length} avsluttede</p>
        </div>
        {canCreate && (
          <Button href="/admin/projects/new" variant="primary" className="px-3 py-1.5 text-xs">
            + Nytt prosjekt
          </Button>
        )}
      </div>

      <ProjectsOverviewClient
        cards={cards}
        activeProjects={active}
        restProjects={rest}
        blCounts={blCounts}
        subCounts={subCounts}
      />
    </div>
  )
}
