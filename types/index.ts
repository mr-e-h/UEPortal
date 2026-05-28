export type UserRole = 'company' | 'project_manager' | 'main' | 'sub'

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
}

/**
 * Admin-managed registry of project categories ("Fiber FTTH", "Strøm",
 * "Veiarbeid", …). Each type owns a checklist template via
 * project_type_checklist_items; when a project is assigned this type, the
 * template is copied into project_checklist_items so per-project edits
 * don't affect the template.
 */
export interface ProjectType {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface ProjectTypeChecklistItem {
  id: string
  project_type_id: string
  label: string
  sort_order: number
  created_at: string
}

export interface ProjectChecklistItem {
  id: string
  project_id: string
  label: string
  sort_order: number
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
  source?: 'manual' | 'change_order'
  line_type?: 'subcontractor_work' | 'internal_cost' | 'material'
}

export type ChangeOrderStatus = 'draft' | 'pending' | 'approved' | 'rejected'

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
  reason: string
  attachment_url: string | null
  status: ChangeOrderStatus
  submitted_at: string | null
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
  total_sales_value_snapshot: number
  already_invoiced_snapshot: number
  remaining_invoice_value_snapshot: number
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
  ue_hours: number
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
  year: number
  month: number
  amount: number
  comment: string
  created_at: string
}

export interface ActivityEntry {
  id: string
  entity_type: 'weekly_report' | 'change_order'
  entity_id: string
  action: 'approved' | 'rejected' | 'reverted' | 'commented' | 'edited' | 'sent_to_customer'
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
