import { ReactNode } from 'react'
import type { StatusMeta } from '@/lib/statuses'

export type StatusTone = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'primary'

const styles: Record<StatusTone, string> = {
  green: 'bg-green-50 text-green-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  blue: 'bg-blue-50 text-blue-700',
  gray: 'bg-muted text-[var(--color-text-secondary)]',
  primary: 'bg-primary-soft text-primary',
}

/**
 * DEN kanoniske statuspillen.
 *
 *   <StatusPill meta={changeOrderStatus(co.status)} />   ← domenestatuser:
 *   hent metaen (label + farger) fra lib/statuses.ts, så er ord og farger
 *   like overalt. Ikke håndrull piller med egne labels i komponenter.
 *
 *   <StatusPill tone="amber">Priser mangler</StatusPill> ← frie, lokale
 *   merkelapper uten domenestatus.
 */
export default function StatusPill({
  children,
  tone = 'gray',
  meta,
}: {
  children?: ReactNode
  tone?: StatusTone
  meta?: StatusMeta
}) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta ? meta.cls : styles[tone]}`}>
      {meta ? meta.label : children}
    </span>
  )
}
