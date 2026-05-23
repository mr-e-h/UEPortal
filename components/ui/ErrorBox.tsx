import { ReactNode } from 'react'

type Variant = 'error' | 'success' | 'info' | 'warning'

const styles: Record<Variant, string> = {
  error: 'text-red-700 bg-red-50 border-red-200',
  success: 'text-green-700 bg-green-50 border-green-200',
  info: 'text-blue-700 bg-blue-50 border-blue-200',
  warning: 'text-amber-700 bg-amber-50 border-amber-200',
}

/**
 * Inline banner for form errors, success messages, info notes. Replaces
 * the many ad-hoc <div className="text-sm text-red-700 bg-red-50 ...">
 * boxes scattered across pages.
 */
export default function ErrorBox({
  children,
  variant = 'error',
  className = '',
}: {
  children: ReactNode
  variant?: Variant
  className?: string
}) {
  return (
    <div className={`text-sm border rounded px-3 py-2 ${styles[variant]} ${className}`}>
      {children}
    </div>
  )
}
