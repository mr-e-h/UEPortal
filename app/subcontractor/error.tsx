'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Subcontractor-segment error boundary. Layout (sidebar, header) stays
 * mounted; only the main content is swapped for the error.
 */
export default function SubcontractorError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Subcontractor error boundary caught:', error)
  }, [error])

  return (
    <div className="p-6">
      <div className="max-w-xl bg-red-50 border border-red-200 rounded-lg p-6 space-y-3">
        <h2 className="text-base font-semibold text-red-800">Noe gikk galt</h2>
        <p className="text-sm text-red-700">
          {error.message || 'En uventet feil oppsto. Prøv igjen.'}
        </p>
        {error.digest && (
          <p className="text-xs text-red-600 font-mono">Feil-ID: {error.digest}</p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            onClick={reset}
            className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700"
          >
            Prøv igjen
          </button>
          <Link
            href="/subcontractor"
            className="px-3 py-1.5 bg-white border border-red-300 text-red-700 text-xs font-medium rounded hover:bg-red-100"
          >
            Til oversikt
          </Link>
        </div>
      </div>
    </div>
  )
}
