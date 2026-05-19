export interface MilestoneColor {
  label: string
  value: string
}

export const MILESTONE_COLORS: MilestoneColor[] = [
  { label: 'Blå',     value: '#3B82F6' },
  { label: 'Grønn',   value: '#10B981' },
  { label: 'Rød',     value: '#EF4444' },
  { label: 'Oransje', value: '#F59E0B' },
  { label: 'Lilla',   value: '#8B5CF6' },
  { label: 'Teal',    value: '#14B8A6' },
  { label: 'Rosa',    value: '#EC4899' },
  { label: 'Grå',     value: '#6B7280' },
]

export const DEFAULT_MILESTONE_COLOR = MILESTONE_COLORS[0].value
