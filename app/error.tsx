'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Root-level error boundary. Catches any uncaught error from a route
 * segment that doesn't have its own error.tsx. Shows a friendly Norwegian
 * message + a reset button instead of Next.js's default error screen.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Forward to whatever observability we add later (Sentry, Vercel, …).
    console.error('Root error boundary caught:', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center space-y-4">
        <h1 className="text-lg font-semibold text-gray-900">Noe gikk galt</h1>
        <p className="text-sm text-gray-600">
          En uventet feil oppsto. Prøv igjen — vedvarer det, kontakt admin.
        </p>
        {error.digest && (
          <p className="text-xs text-gray-400 font-mono">Feil-ID: {error.digest}</p>
        )}
        <div className="flex gap-2 justify-center pt-2">
          <button
            onClick={reset}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            Prøv igjen
          </button>
          <Link
            href="/"
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
          >
            Til forsiden
          </Link>
        </div>
      </div>
    </div>
  )
}
