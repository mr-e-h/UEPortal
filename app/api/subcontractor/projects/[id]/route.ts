import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { resolveEffectiveSub } from '@/lib/tender'
import { fmtProductLabel } from '@/lib/format'
import { emNeedsAction, wrNeedsAction, emNeedsRevision } from '@/lib/attention'
import {
  SUBCONTRACTOR_PROJECT_FIELDS,
  type SubcontractorProjectFields,
} from '@/lib/subcontractor-project-detail'
import type {
  ProjectSubcontractor,
  ProjectBudgetLine,
  Product,
  User,
  WeeklyReport,
  WeeklyReportLine,
  ChangeOrder,
} from '@/types'

interface ProjectManagerLink {
  project_id: string
  user_id: string
}

interface UEInvoice {
  id: string
  subcontractor_id: string
  project_id: string | null
  amount: number
}

/**
 * GET /api/subcontractor/projects/[id] — ETT prosjekt scopet til denne UE-en.
 *
 * Speiler enrich-shapen til ÉN rad fra GET /api/subcontractor/projects (lista)
 * for ett enkelt prosjekt. Subcontractor-en utledes strengt fra (effektiv)
 * sesjon — honorerer super-admin view-as, avviser ekte admin/byggeleder og
 * ignorerer enhver subcontractor_id i URL-en — så én UE aldri kan be om en
 * annens data. Tilknytning verifiseres via project_subcontractors; ikke
 * tilknyttet => 404.
 *
 * UE-PRIS-ISOLASJON: kun UE-egne kosttall (subcontractor_cost_price_snapshot,
 * total_cost på godkjente EM-er). Ingen kundepris (customer_price_snapshot /
 * total_customer_value / profit) eller andre UEers tall lekkes — vi selecter
 * aldri kundepris-feltene og scoper alt til denne UE-en.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const eff = await resolveEffectiveSub()
  if (!eff) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  const subcontractorId = eff.subId
  const projectId = params.id
  const sb = getSupabaseAdmin()

  // Ownership-gate FØRST: er denne UE-en tilknyttet dette prosjektet i det hele
  // tatt? Hvis ikke, 404 før vi henter noe annet — én UE kan aldri se et
  // prosjekt den ikke er tilordnet.
  const linkRes = await sb
    .from('project_subcontractors')
    .select('*')
    .eq('subcontractor_id', subcontractorId)
    .eq('project_id', projectId)
    .maybeSingle<ProjectSubcontractor>()

  if (!linkRes.data) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  }

  // Hent prosjektet — eksplisitt felt-liste (aldri select('*'), se
  // SUBCONTRACTOR_PROJECT_FIELDS): holder reconciliation_status og andre interne
  // kolonner UTE av UE-laget. Utelat slettede slik som lista (neq deleted).
  const projectRes = await sb
    .from('projects')
    .select(SUBCONTRACTOR_PROJECT_FIELDS)
    .eq('id', projectId)
    .neq('deleted', true)
    .maybeSingle<SubcontractorProjectFields>()

  if (!projectRes.data) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  }
  const project = projectRes.data

  // Resten i parallell — alt scopet til denne UE-en OG dette ene prosjektet, så
  // vi aldri sender over data for andre prosjekter eller andre UE-er.
  const [
    budgetLinesRes,
    productsRes,
    pmLinksRes,
    usersRes,
    wrRes,
    coRes,
    invRes,
  ] = await Promise.all([
    sb.from('project_budget_lines').select('*').eq('assigned_subcontractor_id', subcontractorId).eq('project_id', projectId),
    sb.from('products').select('id, name, description, unit'),
    sb.from('project_managers').select('project_id, user_id').eq('project_id', projectId),
    sb.from('users').select('id, full_name, email, active').eq('active', true),
    sb.from('weekly_reports').select('id, project_id, status').eq('subcontractor_id', subcontractorId).eq('project_id', projectId),
    sb.from('change_orders').select('id, project_id, status, total_cost').eq('subcontractor_id', subcontractorId).eq('project_id', projectId),
    sb.from('ue_invoices').select('id, subcontractor_id, project_id, amount').eq('subcontractor_id', subcontractorId).eq('project_id', projectId),
  ])

  const allBudgetLines = (budgetLinesRes.data ?? []) as ProjectBudgetLine[]
  const allProducts = (productsRes.data ?? []) as Pick<Product, 'id' | 'name' | 'description' | 'unit'>[]
  const pmLinks = (pmLinksRes.data ?? []) as ProjectManagerLink[]
  const allUsers = (usersRes.data ?? []) as Pick<User, 'id' | 'full_name' | 'email'>[]
  const myReports = (wrRes.data ?? []) as Pick<WeeklyReport, 'id' | 'project_id' | 'status'>[]
  const myChangeOrders = (coRes.data ?? []) as Pick<ChangeOrder, 'id' | 'project_id' | 'status' | 'total_cost'>[]
  const myInvoices = (invRes.data ?? []) as UEInvoice[]

  // Hent weekly_report_lines kun for VÅRE godkjente rapporter på dette
  // prosjektet — uten dette ville vi dratt hver linje i DB over the wire.
  const approvedReportIds = myReports
    .filter((r) => r.status === 'approved' || r.status === 'partially_approved')
    .map((r) => r.id)
  const wrlRes = approvedReportIds.length > 0
    ? await sb.from('weekly_report_lines').select('id, weekly_report_id, project_budget_line_id, reported_quantity, status').in('weekly_report_id', approvedReportIds)
    : { data: [] as WeeklyReportLine[] }
  const allReportLines = (wrlRes.data ?? []) as WeeklyReportLine[]

  // Lookups
  const productMap = new Map(allProducts.map((p) => [p.id, p]))
  const blMap = new Map(allBudgetLines.map((bl) => [bl.id, bl]))
  const usersById = new Map(allUsers.map((u) => [u.id, u]))

  // Approved-value: godkjente ukesrapport-linjer (qty × kost) PLUSS godkjente
  // endringsmeldinger (deres allerede-beregnede total_cost). Identisk formel som
  // lista, men her implisitt scopet til dette prosjektet siden alt vi hentet er.
  let approvedValue = 0
  for (const line of allReportLines) {
    if (line.status !== 'approved') continue
    const bl = blMap.get(line.project_budget_line_id)
    if (!bl || bl.project_id !== projectId) continue
    approvedValue += line.reported_quantity * bl.subcontractor_cost_price_snapshot
  }
  for (const co of myChangeOrders) {
    if (co.status !== 'approved') continue
    approvedValue += co.total_cost
  }

  // Invoiced-amount (ue_invoices.project_id kan være null for en ikke-tilordnet
  // faktura — de er allerede filtrert bort av .eq('project_id', projectId)).
  let invoicedValue = 0
  for (const inv of myInvoices) {
    if (!inv.project_id) continue
    invoicedValue += inv.amount
  }

  // Order-value (kr) = sum av denne UE-ens tilordnede budsjettlinjer på
  // kostsiden. Samme formel som lista/dashboardet. UE-eget kosttall — ingen
  // kundepris.
  let budgetValue = 0
  for (const bl of allBudgetLines) {
    if (bl.project_id !== projectId) continue
    if (!(bl.line_type === 'subcontractor_work' || bl.line_type == null)) continue
    budgetValue += bl.budget_quantity * bl.subcontractor_cost_price_snapshot
  }

  // Per-prosjekt saks-tellinger — samme definisjon som lista/dashboardet.
  //   pending_em_count       — EM-er som venter på admin (emNeedsAction)
  //   pending_weekly_count   — ukesrapporter som venter på admin (wrNeedsAction)
  //   revision_count         — EM-er admin har sendt tilbake (UEs egen oppgave)
  let pendingEmCount = 0
  let revisionCount = 0
  for (const co of myChangeOrders) {
    if (emNeedsAction(co.status)) {
      pendingEmCount += 1
    } else if (emNeedsRevision(co.status)) {
      revisionCount += 1
    }
  }
  let pendingWeeklyCount = 0
  for (const r of myReports) {
    if (wrNeedsAction(r.status)) {
      pendingWeeklyCount += 1
    }
  }

  // PM-kontakter for dette prosjektet
  const projectManagers: Array<Pick<User, 'id' | 'full_name' | 'email'>> = []
  for (const link of pmLinks) {
    if (link.project_id !== projectId) continue
    const user = usersById.get(link.user_id)
    if (!user) continue
    projectManagers.push({ id: user.id, full_name: user.full_name, email: user.email })
  }

  const assignedLines = allBudgetLines.filter(
    (bl) =>
      bl.project_id === project.id &&
      (bl.line_type === 'subcontractor_work' || bl.line_type == null),
  )
  const linesWithProduct = assignedLines.map((bl) => {
    const product = productMap.get(bl.product_id)
    return {
      id: bl.id,
      product_id: bl.product_id,
      // product_name bærer den kanoniske 'KODE - Navn'-etiketten så sub-UI-en
      // slipper å skille description vs name. product_description er den rå
      // koden for kallere som fortsatt vil ha dem fra hverandre.
      product_name: fmtProductLabel(product),
      product_description: product?.description ?? '',
      unit: product?.unit ?? '',
      budget_quantity: bl.budget_quantity,
      subcontractor_cost_price_snapshot: bl.subcontractor_cost_price_snapshot,
    }
  })

  const result = {
    ...project,
    budget_lines: linesWithProduct,
    project_managers: projectManagers,
    // budget_value er UE-ens eget kostbudsjett (ordreverdi på kostsiden) —
    // serveren sender det ferdig summert så klienten slipper å regne det fra
    // budget_lines, og det stemmer med dashboardets order_value.
    budget_value: budgetValue,
    approved_value: approvedValue,
    invoiced_value: invoicedValue,
    pending_em_count: pendingEmCount,
    pending_weekly_count: pendingWeeklyCount,
    revision_count: revisionCount,
  }

  return NextResponse.json(result)
}
