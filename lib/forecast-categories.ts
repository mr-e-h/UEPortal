import type { ProjectMonthPlan, TimeType } from '@/types'

export type ForecastField = 'revenue' | 'ueCost' | 'internalCost' | 'internalHours' | 'otherCost' | 'risk'
export type ForecastUnit = 'kr' | 'timer'

export interface ForecastCategory {
  key: ForecastField
  label: string
  color: string
  unit: ForecastUnit
  planKey: keyof ProjectMonthPlan
}

export const FORECAST_CATEGORIES: ForecastCategory[] = [
  { key: 'revenue',       label: 'Inntekt',         color: 'text-green-700',  unit: 'kr',    planKey: 'expected_revenue' },
  { key: 'ueCost',        label: 'UE-kostnad',      color: 'text-orange-600', unit: 'kr',    planKey: 'ue_cost' },
  { key: 'internalCost',  label: 'Internkostnad',   color: 'text-purple-600', unit: 'kr',    planKey: 'internal_cost' },
  { key: 'internalHours', label: 'Interne timer',   color: 'text-purple-400', unit: 'timer', planKey: 'internal_hours' },
  { key: 'otherCost',     label: 'Annen kostnad',   color: 'text-gray-600',   unit: 'kr',    planKey: 'other_cost' },
  { key: 'risk',          label: 'Risiko',          color: 'text-amber-600',  unit: 'kr',    planKey: 'risk' },
]

export const FORECAST_PLAN_KEY: Record<ForecastField, keyof ProjectMonthPlan> = FORECAST_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.key]: c.planKey }),
  {} as Record<ForecastField, keyof ProjectMonthPlan>
)

export type ForecastRoleKey = 'pm' | 'bl' | 'dok'

export interface ForecastTimeRole {
  key: ForecastRoleKey
  label: string
  /** Primary lookup — references time_types.json id */
  timeTypeId: string
  /** Fallback if the ID is missing (e.g. data reset) — matched against time_type name */
  fallbackName: string
}

export const FORECAST_TIME_ROLES: ForecastTimeRole[] = [
  { key: 'pm',  label: 'Prosjektleder', timeTypeId: '1', fallbackName: 'Prosjektleder' },
  { key: 'bl',  label: 'Byggeleder',    timeTypeId: '2', fallbackName: 'Byggeleder' },
  { key: 'dok', label: 'Dokumentasjon', timeTypeId: '3', fallbackName: 'Dokumentasjon' },
]

export const FORECAST_ROLE_LABEL: Record<ForecastRoleKey, string> = FORECAST_TIME_ROLES.reduce(
  (acc, r) => ({ ...acc, [r.key]: r.label }),
  {} as Record<ForecastRoleKey, string>
)

const ROLE_BY_KEY = new Map<ForecastRoleKey, ForecastTimeRole>(FORECAST_TIME_ROLES.map((r) => [r.key, r]))

/**
 * Resolve a forecast role to its TimeType row. Prefers id-based lookup,
 * falls back to name-based to survive accidental id reassignments.
 */
export function findTimeTypeForRole(
  roleKey: ForecastRoleKey,
  timeTypes: TimeType[]
): TimeType | undefined {
  const role = ROLE_BY_KEY.get(roleKey)
  if (!role) return undefined
  return (
    timeTypes.find((t) => t.id === role.timeTypeId && t.active) ??
    timeTypes.find((t) => t.name === role.fallbackName && t.active)
  )
}

export function getRoleCostPerHour(roleKey: ForecastRoleKey, timeTypes: TimeType[]): number {
  return findTimeTypeForRole(roleKey, timeTypes)?.cost_per_hour ?? 0
}
