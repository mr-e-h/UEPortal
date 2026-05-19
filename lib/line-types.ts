import type { ProjectBudgetLine } from '@/types'

export type LineType = NonNullable<ProjectBudgetLine['line_type']>

export interface LineTypeMeta {
  value: LineType
  label: string
  shortLabel: string
}

export const LINE_TYPES: LineTypeMeta[] = [
  { value: 'subcontractor_work', label: 'UE-arbeid',         shortLabel: 'UE' },
  { value: 'internal_cost',      label: 'Interne kostnader', shortLabel: 'Intern' },
  { value: 'material',           label: 'Materiell',          shortLabel: 'Materiell' },
]

const LINE_TYPE_BY_VALUE = new Map<LineType, LineTypeMeta>(LINE_TYPES.map((l) => [l.value, l]))

export const LINE_TYPE_LABELS: Record<LineType, string> = LINE_TYPES.reduce(
  (acc, l) => ({ ...acc, [l.value]: l.label }),
  {} as Record<LineType, string>
)

export const LINE_TYPE_SHORT_LABELS: Record<LineType, string> = LINE_TYPES.reduce(
  (acc, l) => ({ ...acc, [l.value]: l.shortLabel }),
  {} as Record<LineType, string>
)

export function lineTypeLabel(value: string | null | undefined): string {
  if (!value) return LINE_TYPE_LABELS.subcontractor_work
  return LINE_TYPE_BY_VALUE.get(value as LineType)?.label ?? value
}

export const DEFAULT_LINE_TYPE: LineType = 'subcontractor_work'
