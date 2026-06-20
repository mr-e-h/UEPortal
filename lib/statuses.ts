import type {
  WeeklyReportStatus,
  WeeklyReportLineStatus,
  ChangeOrderStatus,
  ChangeOrderType,
  ForecastStatus,
  ForecastPeriodStatus,
  ProjectStatus,
  ReconciliationStatus,
  ReportStatus,
  TenderStatus,
  TenderInvitationStatus,
} from '@/types'

export interface StatusMeta {
  label: string
  cls: string
}

const FALLBACK: StatusMeta = { label: '', cls: 'bg-gray-100 text-gray-600' }

// ─── Weekly Report ─────────────────────────────────────────────────────────────

export const WEEKLY_REPORT_STATUSES: Record<WeeklyReportStatus, StatusMeta> = {
  draft:              { label: 'Kladd',           cls: 'bg-gray-100 text-gray-500' },
  submitted:          { label: 'Sendt inn',       cls: 'bg-yellow-100 text-yellow-700' },
  approved:           { label: 'Godkjent',        cls: 'bg-green-100 text-green-700' },
  partially_approved: { label: 'Delvis godkjent', cls: 'bg-blue-100 text-blue-700' },
  rejected:           { label: 'Avslått',         cls: 'bg-red-100 text-red-700' },
}

export function weeklyReportStatus(status: string): StatusMeta {
  return WEEKLY_REPORT_STATUSES[status as WeeklyReportStatus] ?? { ...FALLBACK, label: status }
}

// ─── Weekly Report Line ────────────────────────────────────────────────────────

export const WEEKLY_REPORT_LINE_STATUSES: Record<WeeklyReportLineStatus, StatusMeta> = {
  pending:  { label: 'Venter',   cls: 'bg-gray-100 text-gray-500' },
  approved: { label: 'Godkjent', cls: 'bg-green-100 text-green-700' },
  rejected: { label: 'Avslått',  cls: 'bg-red-100 text-red-700' },
}

export function weeklyReportLineStatus(status: string): StatusMeta {
  return WEEKLY_REPORT_LINE_STATUSES[status as WeeklyReportLineStatus] ?? { ...FALLBACK, label: status }
}

// ─── Change Order ──────────────────────────────────────────────────────────────

export const CHANGE_ORDER_STATUSES: Record<ChangeOrderStatus, StatusMeta> = {
  draft:              { label: 'Utkast',          cls: 'bg-gray-100 text-gray-600' },
  pending:            { label: 'Venter',          cls: 'bg-yellow-100 text-yellow-700' },
  revision_requested: { label: 'Trenger revisjon', cls: 'bg-orange-100 text-orange-700' },
  approved:           { label: 'Godkjent',        cls: 'bg-green-100 text-green-700' },
  rejected:           { label: 'Avvist',          cls: 'bg-red-100 text-red-700' },
}

export function changeOrderStatus(status: string): StatusMeta {
  return CHANGE_ORDER_STATUSES[status as ChangeOrderStatus] ?? { ...FALLBACK, label: status }
}

/**
 * EM-pillen med pending-nyansen: en ventende EM er enten «Ubehandlet» eller
 * «Sendt kunde» (sent_to_customer_at satt). Brukes av EM-detalj og dashboard
 * så nyansen får samme ord og farger overalt.
 */
export function changeOrderPill(status: string, sentToCustomer: boolean): StatusMeta {
  if (status === 'pending') {
    return sentToCustomer
      ? { label: 'Sendt kunde', cls: 'bg-blue-50 text-blue-700' }
      : { label: 'Ubehandlet', cls: 'bg-amber-50 text-amber-700' }
  }
  if (status === 'revision_requested') {
    return { label: 'Trenger revisjon hos UE', cls: 'bg-orange-100 text-orange-700' }
  }
  return changeOrderStatus(status)
}

// ─── Change Order Type ─────────────────────────────────────────────────────────

export const CHANGE_ORDER_TYPES: Record<ChangeOrderType, StatusMeta> = {
  economic:       { label: 'Økonomisk',       cls: 'bg-blue-100 text-blue-700' },
  spec_deviation: { label: 'Avvik kravspec',  cls: 'bg-purple-100 text-purple-700' },
  time:           { label: 'Tid',             cls: 'bg-teal-100 text-teal-700' },
}

export function changeOrderType(type: string): StatusMeta {
  return CHANGE_ORDER_TYPES[type as ChangeOrderType] ?? { ...FALLBACK, label: type }
}

// ─── Forecast ──────────────────────────────────────────────────────────────────

export const FORECAST_STATUSES: Record<ForecastStatus, StatusMeta> = {
  not_started: { label: 'Ikke påbegynt', cls: 'bg-gray-100 text-gray-500' },
  draft:       { label: 'Påbegynt',      cls: 'bg-blue-50 text-blue-600' },
  submitted:   { label: 'Sendt inn',     cls: 'bg-yellow-100 text-yellow-700' },
  approved:    { label: 'Godkjent',      cls: 'bg-green-100 text-green-700' },
  returned:    { label: 'Returnert',     cls: 'bg-red-100 text-red-700' },
  locked:      { label: 'Låst',          cls: 'bg-gray-200 text-gray-600' },
}

export function forecastStatus(status: string): StatusMeta {
  return FORECAST_STATUSES[status as ForecastStatus] ?? { ...FALLBACK, label: status }
}

// ─── Forecast Period ───────────────────────────────────────────────────────────

export const FORECAST_PERIOD_STATUSES: Record<ForecastPeriodStatus, StatusMeta> = {
  open:   { label: 'Åpen', cls: 'bg-green-50 text-green-700' },
  locked: { label: 'Låst', cls: 'bg-gray-100 text-gray-500' },
}

export function forecastPeriodStatus(status: string): StatusMeta {
  return FORECAST_PERIOD_STATUSES[status as ForecastPeriodStatus] ?? { ...FALLBACK, label: status }
}

// ─── Project ───────────────────────────────────────────────────────────────────

export const PROJECT_STATUSES: Record<ProjectStatus, StatusMeta> = {
  active:    { label: 'Aktivt',    cls: 'bg-green-50 text-green-700' },
  completed: { label: 'Fullført',  cls: 'bg-blue-50 text-blue-700' },
  archived:  { label: 'Arkivert',  cls: 'bg-gray-100 text-gray-500' },
}

export function projectStatus(status: string): StatusMeta {
  return PROJECT_STATUSES[status as ProjectStatus] ?? { ...FALLBACK, label: status }
}

// ─── Reconciliation (avstemming mot kunde før lukking) ───────────────────────────

export const RECONCILIATION_STATUSES: Record<ReconciliationStatus, StatusMeta> = {
  not_started:           { label: 'Ikke startet',        cls: 'bg-gray-100 text-gray-500' },
  in_progress:           { label: 'Under avstemming',    cls: 'bg-blue-50 text-blue-600' },
  ready_for_final_check: { label: 'Klar for sluttsjekk', cls: 'bg-yellow-100 text-yellow-700' },
  reconciled:            { label: 'Avstemt',             cls: 'bg-green-100 text-green-700' },
  closed:                { label: 'Lukket',              cls: 'bg-gray-200 text-gray-600' },
}

export function reconciliationStatus(status: string): StatusMeta {
  return RECONCILIATION_STATUSES[status as ReconciliationStatus] ?? { ...FALLBACK, label: status }
}

// ─── Legacy ReportLine status ──────────────────────────────────────────────────

export const REPORT_LINE_STATUSES: Record<ReportStatus, StatusMeta> = {
  draft:     { label: 'Utkast',    cls: 'bg-gray-100 text-gray-600' },
  submitted: { label: 'Innsendt',  cls: 'bg-yellow-100 text-yellow-700' },
  approved:  { label: 'Godkjent',  cls: 'bg-green-100 text-green-700' },
  rejected:  { label: 'Avvist',    cls: 'bg-red-100 text-red-700' },
}

export function reportLineStatus(status: string): StatusMeta {
  return REPORT_LINE_STATUSES[status as ReportStatus] ?? { ...FALLBACK, label: status }
}

// ─── Tender ──────────────────────────────────────────────────────────────────

export const TENDER_STATUSES: Record<TenderStatus, StatusMeta> = {
  draft:        { label: 'Kladd',          cls: 'bg-gray-100 text-gray-600' },
  sent:         { label: 'Sendt',          cls: 'bg-blue-100 text-blue-700' },
  open:         { label: 'Åpen for prising', cls: 'bg-blue-100 text-blue-700' },
  expired:      { label: 'Frist utløpt',   cls: 'bg-orange-100 text-orange-700' },
  under_review: { label: 'Under vurdering', cls: 'bg-yellow-100 text-yellow-700' },
  awarded:      { label: 'Tildelt',        cls: 'bg-green-100 text-green-700' },
  closed:       { label: 'Avsluttet',      cls: 'bg-gray-200 text-gray-600' },
  cancelled:    { label: 'Kansellert',     cls: 'bg-red-100 text-red-700' },
}

export function tenderStatus(status: string): StatusMeta {
  return TENDER_STATUSES[status as TenderStatus] ?? { ...FALLBACK, label: status }
}

// ─── Tender invitation (per-UE) ──────────────────────────────────────────────

export const TENDER_INVITATION_STATUSES: Record<TenderInvitationStatus, StatusMeta> = {
  invited:       { label: 'Invitert',          cls: 'bg-gray-100 text-gray-500' },
  opened:        { label: 'Åpnet',             cls: 'bg-blue-50 text-blue-600' },
  not_answered:  { label: 'Ikke svart',        cls: 'bg-gray-100 text-gray-500' },
  bid_submitted: { label: 'Tilbud sendt',      cls: 'bg-green-100 text-green-700' },
  bid_revised:   { label: 'Revidert tilbud',   cls: 'bg-green-100 text-green-700' },
  expired:       { label: 'Frist utløpt',      cls: 'bg-orange-100 text-orange-700' },
  won:           { label: 'Valgt',             cls: 'bg-green-200 text-green-800' },
  lost:          { label: 'Ikke valgt',        cls: 'bg-gray-100 text-gray-500' },
}

export function tenderInvitationStatus(status: string): StatusMeta {
  return TENDER_INVITATION_STATUSES[status as TenderInvitationStatus] ?? { ...FALLBACK, label: status }
}
