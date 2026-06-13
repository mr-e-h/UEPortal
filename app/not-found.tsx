import Link from 'next/link'

/**
 * Root 404 page — shown when no route matches. Keep it minimal; deeper
 * 404s (e.g. "this project doesn't exist") are typically a normal page
 * rendering a friendlier "not found" state with role-specific links.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center space-y-4">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Siden finnes ikke</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Lenken er kanskje feil, eller siden er flyttet.
        </p>
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          Til forsiden
        </Link>
      </div>
    </div>
  )
}
