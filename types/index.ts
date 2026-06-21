export type UserRole = 'company' | 'project_manager' | 'main' | 'sub' | 'byggeleder'

export interface Invitation {
  id: string
  email: string
  role: 'project_manager' | 'sub'
  /**
   * SHA-256 hash of the invitation token. Raw tokens are only ever shown in
   * the acceptance URL — they are never stored.
   */
  token_hash: string
  created_at: string
  expires_at: string
  accepted_at: string | null
}

export interface PasswordReset {
  id: string
  user_id: string
  /** SHA-256 hash of the reset token (raw token only exists in the email link) */
  token_hash: string
  created_at: string
  expires_at: string
  /** Set when the token has been consumed; single-use only */
  used_at: string | null
}

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected'

export interface AccessRequest {
  id: string
  full_name: string
  email: string
  company: string | null
  phone: string | null
  message: string | null
  desired_role: 'project_manager' | 'sub' | null
  status: AccessRequestStatus
  created_at: string
  decided_at: string | null
  decided_by: string | null
  decision_note: string | null
}
export type ProjectStatus = 'active' | 'completed' | 'archived'
export type ReportStatus = 'draft' | 'submitted' | 'approved' | 'rejected'

export interface User {
  id: string
  email: string
  password: string
  role: UserRole
  full_name: string
  subcontractor_id: string | null
  active: boolean
}

export interface Product {
  id: string
  name: string
  description: string
  unit: string
  county: string
  customer_price: number
  active: boolean
  created_at?: string
}

export interface Subcontractor {
  id: string
  company_name: string
  contact_person: string
  email: string
  phone: string
  organization_number: string
  county: string
  active: boolean
}

export interface SubcontractorProductPrice {
  id: string
  subcontractor_id: string
  product_id: string
  cost_price: number
}

export interface Project {
  id: string
  name: string
  project_number: string
  order_number?: string
  customer: string
  county: string
  status: ProjectStatus
  start_date: string
  end_date: string | null
  deleted: boolean
  deleted_at: string | null
  project_type_id: string | null
  /**
   * Manuell overstyring av tiltenkte interne timer. null = bruk det beregnede
   * tallet (ordreverdi-vektet andel av poolen over varigheten, se
   * /api/projects/[id]/allocated-hours). Satt = admin har dratt det opp/ned.
   */
  planned_hours: number | null
  /**
   * Avstemmingsstatus mot kunde før lukking (migrasjon 0018). Default
   * 'not_started' i DB; valgfri her så historiske/uberørte rader er bakoverkompatible.
   */
  reconciliation_status?: ReconciliationStatus
}

/**
 * Admin-managed registry of project categories ("Fiber FTTH", "Strøm",
 * "Veiarbeid", …). Each type owns a checklist template via
 * project_type_checklist_items; when a project is assigned this type, the
 * template is copied into project_checklist_items so per-project edits
 * don't affect the template.
 */
/**
 * Kolonneoppsett for Excel-import per prosjekttype. 0-baserte kolonneindekser
 * (null = ikke i bruk); startRow er 1-basert raden der produkter begynner.
 * Lar hver kunde/type ha sitt eget arkformat uten kodeendring — se
 * lib/excel-map.ts.
 */
export interface ImportColumnMap {
  startRow: number
  code: number | null
  name: number | null
  price: number | null
  qty: number | null
  fixedPrice: number | null
}

export interface ProjectType {
  id: string
  name: string
  description: string | null
  created_at: string
  /** Tilpasset Excel-kolonneoppsett. null = standardoppsettet brukes. */
  import_config: ImportColumnMap | null
}

export interface ProjectTypeChecklistItem {
  id: string
  project_type_id: string
  label: string
  sort_order: number
  /** true = seksjon-overskrift (grupperer punktene under), false = avhukbart punkt. */
  is_section: boolean
  created_at: string
}

export interface ProjectChecklistItem {
  id: string
  project_id: string
  label: string
  sort_order: number
  /** true = seksjon-overskrift (grupperer punktene under), false = avhukbart punkt. */
  is_section: boolean
  /** ISO string when ticked; null while open. */
  completed_at: string | null
  /** Display name of the user who ticked it. */
  completed_by: string | null
  created_at: string
}

export interface ProjectSubcontractor {
  id: string
  project_id: string
  subcontractor_id: string
}

/**
 * project_manager → project assignment. main/company users see all projects;
 * project_manager users see only the projects in this table. See
 * lib/api-guard.getProjectScope.
 */
export interface ProjectManagerAssignment {
  id: string
  project_id: string
  user_id: string
  assigned_at: string
  assigned_by: string | null
}

export interface ProjectBudgetLine {
  id: string
  project_id: string
  product_id: string
  budget_quantity: number
  customer_price_snapshot: number
  assigned_subcontractor_id: string | null
  subcontractor_cost_price_snapshot: number
  /** Egendefinert etikett (f.eks. «Blåsing») for UE-splittlinjer — vises i stedet
   *  for produktnavnet. Tom = bruk produktnavnet. */
  custom_label?: string
  source?: 'manual' | 'change_order'
  line_type?: 'subcontractor_work' | 'internal_cost' | 'material'
  /** Fase i fremdriftsplanen linja hører til — gir avledet fasevekt (ØKONOMIMODELL.md 1b). */
  phase_id?: string | null
}

/**
 * Materiell-budsjett (migrasjon 0021): eget mengde-budsjett per prosjekt, helt
 * adskilt fra produkter / budsjettlinjer / økonomi. unit_price + supplier lagres
 * for sporing, men VISES ikke som salgsverdi og teller IKKE i ordreverdi. Avstemmes
 * manuelt (actual_quantity) mot planlagt for å få en fasit til slutt.
 */
export interface ProjectMaterial {
  id: string
  project_id: string
  material_code: string
  material_name: string
  category: string
  unit: string
  planned_quantity: number
  unit_price: number
  supplier: string
  /** Faktisk brukt (manuell avstemming). null = ikke avstemt ennå. */
  actual_quantity: number | null
  reconciled: boolean
  comment: string
  sort_order: number
  /** 'excel' = importert (erstattes ved ny Excel-opplasting), 'manual' = lagt til
   *  manuelt (beholdes ved ny Excel-opplasting). */
  source: 'excel' | 'manual'
  created_at?: string
}

/** Én logget versjon av materielliste-opplastingen (forrige beholdes ved ny opplasting). */
export interface ProjectMaterialVersion {
  id: string
  project_id: string
  version: number
  file_name: string | null
  snapshot: { materials: Array<Pick<ProjectMaterial, 'material_code' | 'material_name' | 'category' | 'unit' | 'planned_quantity' | 'unit_price' | 'supplier'>> }
  uploaded_by: string
  uploaded_at: string
  created_at?: string
}

/**
 * Andel av en budsjettlinje tildelt ÉN underentreprenør — for å dele ett produkt
 * mellom flere UE (mengde + kostpris + ansvar per UE). Kunden faktureres for hele
 * produktet via budsjettlinjas mengde × kundepris; UE-kost = Σ(andel.mengde ×
 * andel.kostpris). Brukes KUN når en linje deles — én-UE-linjer bruker fortsatt
 * assigned_subcontractor_id + subcontractor_cost_price_snapshot på selve linja.
 */
export interface ProjectBudgetLineSubcontractor {
  id: string
  budget_line_id: string
  subcontractor_id: string
  quantity: number
  cost_price_snapshot: number
  created_at: string
}

/** Hvem som faktisk utførte produksjonen. 'subcontractor' = UE (tilskrives via
 *  subcontractor_id); 'internal'/'other' = egenprod/intern og vises ALDRI som
 *  UEs produksjon. */
export type ProductionExecutedBy = 'subcontractor' | 'internal' | 'other'

/**
 * Registrert utført produksjon (migrasjon 0018). Føres opptjent STRAKS mot kunde
 * via budsjettlinjas customer_price_snapshot (se lib/project-economy.ts) — rører
 * IKKE fakturerings-laget (ue_invoices/billed_at) og auto-fakturerer ikke
 * (opptjent ≠ fakturert). cost lagres alltid (v1: 0 kr = ordinær UE-kost); cost>0
 * flyter IKKE inn i ueReportedCost i v1 (deferred v2). Eksponeres ALDRI UE-side.
 */
export interface ProductionEntry {
  id: string
  project_id: string
  project_budget_line_id: string | null
  product_id: string
  quantity: number
  unit: string
  executed_by: ProductionExecutedBy
  subcontractor_id: string | null
  cost: number
  comment: string
  created_by: string | null
  created_at: string
}

/**
 * Status på avstemmingen mot kunde før prosjektavslutning (migrasjon 0018, kolonne
 * på projects). Lukk-gate KUN på 'completed'-prosjektstatus i app-laget.
 */
export type ReconciliationStatus =
  | 'not_started'
  | 'in_progress'
  | 'ready_for_final_check'
  | 'reconciled'
  | 'closed'

/**
 * Avstemmingslinje (migrasjon 0018) — én rad per budsjettlinje (nøkkel
 * project_budget_line_id): snapshot av planlagt vs faktisk utført (UE-rapportert
 * vs no-cost) + diff i mengde/kundeverdi, pluss saksbehandling før lukking.
 * planned_quantity/diff_customer_value strippes for ikke-admin i app-laget.
 */
export interface ReconciliationLine {
  id: string
  project_id: string
  project_budget_line_id: string | null
  product_id: string
  planned_quantity: number | null
  executed_ue_quantity: number | null
  executed_no_cost_quantity: number | null
  diff_quantity: number | null
  diff_customer_value: number | null
  resolution: string
  handled: boolean
  handled_by: string | null
  handled_at: string | null
}

/**
 * EM-statusflyt:
 *
 *   draft               UE har påbegynt men ikke sendt inn ennå
 *   pending             Innsendt og venter på admin-godkjenning
 *   revision_requested  Admin har returnert med kommentar — UE må rette opp
 *                       og sende inn på nytt (flippes til pending igjen)
 *   approved            Admin har godkjent
 *   rejected            Admin har avvist (sluttilstand, ikke revisjon)
 */
export type ChangeOrderStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'revision_requested'

/**
 * EM-type — påkrevd ved oppretting av endringsmelding:
 *
 *   economic        "Økonomisk":      tillegg som påvirker budsjett/pris
 *   spec_deviation  "Avvik kravspec": avvik fra opprinnelig kravspesifikasjon
 *   time            "Tid":            tids-tillegg uten direkte budsjetteffekt
 */
export type ChangeOrderType = 'economic' | 'spec_deviation' | 'time'

/**
 * "Konsekvens ved å avslå" — produktlinjer som ble fjernet fra
 * prosjektbudsjettet hvis EMen avvises. Brukt for å vise kunden
 * konsekvensene av en avvisning. Bare admin + PM kan opprette og redigere
 * disse; UE ser dem read-only. På avslag trekker /status-endepunktet
 * mengdene fra matchende project_budget_lines (same project/produkt/UE).
 */
export interface ChangeOrderConsequenceLine {
  id: string
  change_order_id: string
  product_id: string
  quantity: number
  unit: string
  cost_price_snapshot: number
  customer_price_snapshot: number
  sort_order: number
  created_at: string
}

/**
 * One product line within a change order. Multiple lines per EM are
 * supported on the admin edit flow. The parent change_orders row keeps
 * rolled-up totals as a cache for list queries; this table is the source
 * of truth for product / qty / per-line snapshots.
 */
export interface ChangeOrderLine {
  id: string
  change_order_id: string
  product_id: string
  requested_quantity: number
  unit: string
  cost_price_snapshot: number
  customer_price_snapshot: number
  sort_order: number
  created_at: string
}

export interface ChangeOrder {
  id: string
  /**
   * Per-prosjekt løpenummer. Tildeles av Postgres-trigger ved INSERT — stiger
   * 1, 2, 3, ... innen samme project_id uavhengig av hvilken UE som er
   * avsender. Brukes til å bygge tittel-strenger som
   * "Endringsmelding 7 - Sentrumsgården".
   */
  change_order_number: number
  /** Påkrevd type — se ChangeOrderType. */
  em_type: ChangeOrderType
  project_id: string
  product_id: string
  subcontractor_id: string
  requested_quantity: number
  unit: string
  cost_price_snapshot: number
  customer_price_snapshot: number
  total_cost: number
  total_customer_value: number
  profit: number
  /** "Beskrivelse" på skjemaet — hva er endringen. */
  reason: string
  /** "Løsning" — hva blir gjort / hvordan løses det. Tom streng default. */
  solution: string
  attachment_url: string | null
  status: ChangeOrderStatus
  submitted_at: string | null
  /** Full navn på personen som sendte inn EMen — settes fra session.full_name
   *  i POST-endepunktet. Nullable: historiske rader fra før denne kolonnen
   *  ble lagt til kan være tomme. */
  submitted_by: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  admin_comment: string | null
  /** Insert time; DB default = now(). Set after migration `change_orders_created_at`. */
  created_at: string
  /**
   * Stamped when admin clicks 'Eksporter PDF' to forward the EM to the end
   * customer. The status remains 'pending' but the UI pill flips from
   * 'Ubehandlet' to 'Til behandling' so admin can tell at a glance which
   * pending EMs are awaiting the customer's response vs untouched. Cleared
   * on revert/approve/reject so we never carry stale state.
   */
  sent_to_customer_at: string | null
  /** Fakturert-status (migrasjon 0017). null = ikke fakturert. Speiler
   *  weekly_report_lines.billed_at/ue_invoice_id, så en godkjent EM kan
   *  linje-faktureres og avstemmes mot en ue_invoice. */
  billed_at?: string | null
  ue_invoice_id?: string | null
}

export interface ReportLine {
  id: string
  project_id: string
  project_budget_line_id: string
  subcontractor_id: string
  reported_quantity: number
  report_date: string
  comment: string
  status: ReportStatus
}

export interface TimeType {
  id: string
  name: string
  cost_per_hour: number
  active: boolean
}

export interface ProjectHourBudget {
  id: string
  project_id: string
  time_type_id: string
  estimated_hours: number
  created_at: string
}

export interface HourEntry {
  id: string
  project_id: string
  time_type_id: string
  hours: number
  date: string
  comment: string
  cost_per_hour_snapshot: number
  created_at: string
}

export type WeeklyReportStatus = 'draft' | 'submitted' | 'approved' | 'partially_approved' | 'rejected'
export type WeeklyReportLineStatus = 'pending' | 'approved' | 'rejected'

export interface WeeklyReport {
  id: string
  project_id: string
  subcontractor_id: string
  year: number
  week_number: number
  submission_number: number
  status: WeeklyReportStatus
  submitted_at: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  admin_comment: string | null
  created_at: string
}

export interface WeeklyReportLine {
  id: string
  weekly_report_id: string
  project_budget_line_id: string
  reported_quantity: number
  comment: string
  status: WeeklyReportLineStatus
  reviewed_at: string | null
  reviewed_by: string | null
  billed_at: string | null
  ue_invoice_id: string | null
}

export interface InvoiceBasis {
  id: string
  project_id: string
  subcontractor_id: string | null
  type: 'ue' | 'customer'
  period_from: string
  period_to: string
  weekly_report_line_ids: string[]
  change_order_ids: string[]
  total_cost: number
  total_sales_value: number
  status: 'draft' | 'exported' | 'billed'
  created_by: string
  created_at: string
  exported_at: string | null
  billed_at: string | null
}

export interface ProjectInvoice {
  id: string
  project_id: string
  amount: number
  invoice_date: string
  comment: string
  created_by: string
  created_at: string
}

export type ForecastPeriodName = 'P1' | 'P2' | 'P3' | 'P4'
export type ForecastPeriodStatus = 'open' | 'locked'
export type ForecastStatus = 'not_started' | 'draft' | 'submitted' | 'approved' | 'returned' | 'locked'

export interface ForecastPeriod {
  id: string
  name: ForecastPeriodName
  year: number
  start_month: number
  end_month: number
  status: ForecastPeriodStatus
  locked: boolean
  locked_at: string | null
  locked_by: string | null
}

export interface ProjectForecast {
  id: string
  forecast_period_id: string
  project_id: string
  project_manager_id: string | null
  expected_revenue: number
  expected_ue_cost: number
  expected_internal_cost: number
  expected_other_cost: number
  risk_amount: number
  expected_profit: number
  comment: string
  status: ForecastStatus
  submitted_at: string | null
  approved_at: string | null
  approved_by: string | null
  returned_comment: string | null
  created_at: string
  updated_at: string
}

export interface ProjectMonthPlan {
  id: string
  project_id: string
  year: number
  month: number
  expected_revenue: number
  internal_hours: number
  internal_cost: number
  ue_cost: number
  other_cost: number
  risk: number
  comment: string
  updated_at: string
}

export interface ProjectForecastMonth {
  id: string
  project_forecast_id: string
  month: number
  year: number
  expected_revenue: number
  expected_ue_cost: number
  expected_internal_cost: number
  expected_other_cost: number
  risk_amount: number
  comment: string
}

export interface ProjectInternalCostEntry {
  id: string
  project_id: string
  /** one_time: måneden kosten treffer. monthly: startmåned. */
  year: number
  month: number
  /** Beløp. For monthly: per måned. */
  amount: number
  comment: string
  created_at: string
  /** 'one_time' (engang) eller 'monthly' (løper fast hver måned). */
  recurrence: 'one_time' | 'monthly'
  /** monthly: valgfri sluttmåned (null = ut prosjektet). Ubrukt for one_time. */
  end_year: number | null
  end_month: number | null
}

export interface ActivityEntry {
  id: string
  entity_type: 'weekly_report' | 'change_order' | 'tender'
  entity_id: string
  action: 'approved' | 'rejected' | 'reverted' | 'commented' | 'edited' | 'sent_to_customer' | 'revision_requested' | 'resubmitted' | 'submitted' | 'sent' | 'awarded' | 'cancelled' | 'deadline_extended' | 'bid_revised'
  /**
   * Optional structured snapshot. For 'edited' rows: { before, after } with
   * the values at the moment of change. The activity GET endpoint strips
   * customer-pricing keys from this when the requester is a sub, so UE-side
   * popups never leak Salgsverdi / Kundepris / Fortjeneste.
   */
  metadata?: {
    before?: Record<string, unknown>
    after?: Record<string, unknown>
  } | null
  actor: string
  comment?: string
  created_at: string
}

export interface BudgetVersion {
  id: string
  project_id: string
  version: number
  total_sales_value: number
  total_cost_value: number
  uploaded_by: string
  uploaded_at: string
  file_name?: string
}

// ─── Fremdriftsplan (faser + milepæler) ─────────────────────────────────────

/** Fasetype-registeret (globalt) — navn/farge slår gjennom overalt. */
export interface PhaseType {
  id: string
  name: string
  color: string | null
  is_active: boolean
  sort_order: number
}

/** Arbeidsfase på et prosjekt. end_date = null betyr punkthendelse (én dag). */
export interface ProjectPhase {
  id: string
  project_id: string
  phase_type_id: string
  name: string | null
  start_date: string
  end_date: string | null
  status: 'planned' | 'in_progress' | 'done'
  progress_percent: number
  sort_order: number
  /** Tildelt UE (null = generell fase / alle). Brukes til filter + UE-portal. */
  subcontractor_id: string | null
  /** Prognose-vekt: andel av inntekt/UE-kost fasen står for. null = auto
   *  (fasens varighet i måneder brukes). Se lib/forecast-distribution.ts. */
  weight: number | null
}

/**
 * A named internal resource (person/role) in the company-wide pool: monthly
 * hour capacity and an hourly cost. The pool's monthly capacity is spread
 * across the projects active each month (span from the fremdriftsplan),
 * weighted by revenue — see lib/resource-allocation.ts.
 */
export interface InternalResource {
  id: string
  name: string
  hours_per_month: number
  hourly_cost: number
  created_at: string
}

/**
 * Månedlig avstemming av FAKTISK internkost. Ressurspoolen er bare et estimat;
 * én gang i måneden legges totalt antall interntimer brukt inn her. Kosten
 * (total_hours × hourly_cost_snapshot) fordeles på prosjektene som var aktive
 * den måneden, vektet på omsetning — se lib/resource-allocation.ts.
 *
 * hourly_cost_snapshot = teamets snittkost (Σ kost ÷ Σ timer) på
 * avstemmingstidspunktet, låst selv om ressursene endres senere.
 */
export interface InternalHoursMonthly {
  id: string
  year: number
  /** 1–12. */
  month: number
  total_hours: number
  hourly_cost_snapshot: number
  created_at: string
  updated_at: string
}

export interface GanttMilestone {
  id: string
  project_id: string
  subcontractor_id: string | null
  title: string
  start_date: string
  end_date: string
  color: string
  created_at: string
  sort_order?: number
}

/** Øyeblikksbilde av hele fremdriftsplanen (faser + milepæler). */
export interface ProjectPhaseSnapshot {
  phases: ProjectPhase[]
  milestones: GanttMilestone[]
}

/**
 * Én arkivert versjon av fremdriftsplanen: et snapshot + hvem som lagret det og
 * når. Endringsloggen (hvem/hva/fra→til) utledes ved å diffe to versjoner.
 */
export interface ProjectPhaseVersion {
  id: string
  project_id: string
  taken_at: string
  taken_by: string | null
  taken_by_name: string | null
  snapshot: ProjectPhaseSnapshot
  created_at: string
}

// ─── Egenproduksjon — batch-snapshot-historikk (migrasjon 0019) ──────────────

/**
 * Rå celle-snapshot for én budsjettlinje i en produksjonsversjon.
 * INGEN kundeverdi/kr — kun egenprod-mengde + saksbehandlingsfelt.
 */
export interface ProductionSnapshotLine {
  project_budget_line_id: string
  product_id: string
  executed_no_cost_quantity: number | null
  resolution: string
  handled: boolean
}

/**
 * Snapshot-innholdet lagret i project_production_versions.snapshot (jsonb).
 * Speil av ProjectPhaseSnapshot-formen: ett felt med en liste av linjer.
 */
export interface ProductionSnapshot {
  lines: ProductionSnapshotLine[]
}

/**
 * Én arkivert versjon av egenproduksjonstilstanden per prosjekt (migrasjon 0019).
 * Lagres etter batch-PUT /api/production-entries/batch når noe faktisk endret seg
 * (dedup mot siste versjon — no-op hopper over insert). Speiler ProjectPhaseVersion.
 */
export interface ProductionVersion {
  id: string
  project_id: string
  taken_at: string
  taken_by: string | null
  taken_by_name: string
  snapshot: ProductionSnapshot
  created_at: string
}

// ─── Tender / bidding module ─────────────────────────────────────────────────

/**
 * Lifecycle of a tender (anbudsforespørsel):
 *  draft        – being built by the PM, not visible to any UE
 *  sent         – published; invited UEs can now see and price it
 *  open         – alias kept for clarity; treated like 'sent' while before deadline
 *  expired      – deadline passed; UEs can no longer change their bids
 *  under_review – PM is comparing bids (manual step before awarding)
 *  awarded      – a winner was chosen; prices pushed into the project budget
 *  closed       – archived/finished
 *  cancelled    – withdrawn by the PM
 */
export type TenderStatus =
  | 'draft' | 'sent' | 'open' | 'expired' | 'under_review' | 'awarded' | 'closed' | 'cancelled'

/**
 * Per-UE invitation state:
 *  invited       – sent, not yet opened
 *  opened        – UE has viewed the tender
 *  not_answered  – deadline passed without a submitted bid
 *  bid_submitted – UE submitted a bid
 *  bid_revised   – UE submitted a revised bid (round/edit)
 *  expired       – invitation no longer actionable
 *  won           – this UE was awarded the tender
 *  lost          – another UE was awarded
 */
export type TenderInvitationStatus =
  | 'invited' | 'opened' | 'not_answered' | 'bid_submitted' | 'bid_revised' | 'expired' | 'won' | 'lost'

export type TenderBidStatus = 'draft' | 'submitted'

export interface Tender {
  id: string
  project_id: string
  title: string
  description: string
  status: TenderStatus
  deadline_at: string | null
  current_round: number
  awarded_subcontractor_id: string | null
  awarded_at: string | null
  awarded_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TenderLine {
  id: string
  tender_id: string
  /** Catalog product when set; null = free-text work operation. */
  product_id: string | null
  description: string
  unit: string
  quantity: number
  sort_order: number
  created_at: string
}

export interface TenderInvitation {
  id: string
  tender_id: string
  subcontractor_id: string
  status: TenderInvitationStatus
  round: number
  invited_at: string
  opened_at: string | null
  created_at: string
}

export interface TenderBid {
  id: string
  tender_id: string
  subcontractor_id: string
  round: number
  status: TenderBidStatus
  total_cost: number
  comment: string
  is_current: boolean
  submitted_at: string | null
  submitted_by: string | null
  created_at: string
  updated_at: string
}

export interface TenderBidLine {
  id: string
  tender_bid_id: string
  tender_line_id: string
  unit_price: number
  created_at: string
}
