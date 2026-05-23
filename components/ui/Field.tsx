import { ReactNode } from 'react'

/**
 * Label + input wrapper used across forms. Pulls out the repeated
 *   <div><label>X</label>{children}</div>
 * pattern that was inlined in ~20 places.
 */
export default function Field({
  label,
  children,
  className = '',
  hint,
  error,
}: {
  label: string
  children: ReactNode
  className?: string
  hint?: string
  error?: string
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
