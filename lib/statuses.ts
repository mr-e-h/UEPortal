import type {
  WeeklyReportStatus,
  WeeklyReportLineStatus,
  ChangeOrderStatus,
  ForecastStatus,
  ForecastPeriodStatus,
  ProjectStatus,
  ReportStatus,
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
  draft:    { label: 'Utkast',   cls: 'bg-gray-100 text-gray-600' },
  pending:  { label: 'Venter',   cls: 'bg-yellow-100 text-yellow-700' },
  approved: { label: 'Godkjent', cls: 'bg-green-100 text-green-700' },
  rejected: { label: 'Avvist',   cls: 'bg-red-100 text-red-700' },
}

export function changeOrderStatus(status: string): StatusMeta {
  return CHANGE_ORDER_STATUSES[status as ChangeOrderStatus] ?? { ...FALLBACK, label: status }
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
