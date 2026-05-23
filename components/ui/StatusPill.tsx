import { ReactNode } from 'react'

export type StatusTone = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'primary'

const styles: Record<StatusTone, string> = {
  green: 'bg-green-50 text-green-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  blue: 'bg-blue-50 text-blue-700',
  gray: 'bg-gray-100 text-gray-600',
  primary: 'bg-primary-soft text-primary',
}

/**
 * Free-form status badge with explicit tone. Use Badge.tsx for the canonical
 * project/report statuses; use StatusPill when the meaning is local
 * (e.g. "Aktiv"/"Av", "Priser mangler", "Ventende invitasjon").
 */
export default function StatusPill({
  children,
  tone = 'gray',
}: {
  children: ReactNode
  tone?: StatusTone
}) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[tone]}`}>
      {children}
    </span>
  )
}
