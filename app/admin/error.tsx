'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Admin-segment error boundary. Wraps the admin layout so errors inside
 * any /admin/* page don't blow up the whole shell — sidebar/header stay
 * visible via the layout, only the main pane is replaced.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Admin error boundary caught:', error)
  }, [error])

  return (
    <div className="p-6">
      <div className="max-w-xl bg-red-50 border border-red-200 rounded-lg p-6 space-y-3">
        <h2 className="text-base font-semibold text-red-800">Noe gikk galt på denne siden</h2>
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
            href="/admin"
            className="px-3 py-1.5 bg-white border border-red-300 text-red-700 text-xs font-medium rounded hover:bg-red-100"
          >
            Til dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
