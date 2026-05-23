import { ReactNode } from 'react'

/**
 * Standard empty-list display. Used inside Cards and tables when there's
 * nothing to show. Keep it small and quiet — empty isn't a problem state.
 */
export default function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="py-10 px-6 text-center text-sm">
      {icon && <div className="mx-auto mb-2 text-[var(--color-text-muted)]">{icon}</div>}
      <p className="font-medium text-[var(--color-text-primary)]">{title}</p>
      {description && <p className="mt-1 text-[var(--color-text-muted)]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
