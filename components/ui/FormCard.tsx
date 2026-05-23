import { ReactNode } from 'react'
import Card from './Card'

/**
 * Card with a consistent heading + body padding for forms and grouped fields.
 * Reduces repetition of `<Card className="p-6 space-y-4"><h2 className="text-sm font-semibold...">...`.
 */
export default function FormCard({
  title,
  description,
  children,
  action,
  className = '',
}: {
  title?: string
  description?: string
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <Card className={`p-6 ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between mb-4 gap-4">
          <div>
            {title && (
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>
            )}
            {description && (
              <p className="text-xs text-[var(--color-text-muted)] mt-1">{description}</p>
            )}
          </div>
          {action && <div className="flex-none">{action}</div>}
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </Card>
  )
}
