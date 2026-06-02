import type { ActivityEntry } from '@/types'

export const ACTIVITY_ACTION_LABELS: Record<ActivityEntry['action'], string> = {
  submitted:          'Sendte inn',
  approved:           'Godkjente',
  rejected:           'Avslo',
  reverted:           'Angret',
  commented:          'Kommenterte',
  edited:             'Redigerte',
  sent_to_customer:   'Sendte til kunde',
  revision_requested: 'Ba om ny versjon',
  resubmitted:        'Sendte inn ny versjon',
  // Tender module
  sent:               'Sendte ut anbud',
  awarded:            'Tildelte anbud',
  cancelled:          'Kansellerte',
  deadline_extended:  'Forlenget frist',
  bid_revised:        'Reviderte tilbud',
}

export function activityActionLabel(action: string): string {
  return ACTIVITY_ACTION_LABELS[action as ActivityEntry['action']] ?? action
}
