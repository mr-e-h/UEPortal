import type { ActivityEntry } from '@/types'

export const ACTIVITY_ACTION_LABELS: Record<ActivityEntry['action'], string> = {
  approved:  'Godkjente',
  rejected:  'Avslo',
  reverted:  'Angret',
  commented: 'Kommenterte',
}

export function activityActionLabel(action: string): string {
  return ACTIVITY_ACTION_LABELS[action as ActivityEntry['action']] ?? action
}
