import Link from 'next/link'

export default function AdminNotFound() {
  return (
    <div className="p-6">
      <div className="max-w-xl bg-muted border border-border rounded-lg p-6 space-y-3 text-center">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Siden finnes ikke</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">Sjekk lenken eller gå tilbake til dashboardet.</p>
        <Link
          href="/admin"
          className="inline-block px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700"
        >
          Til dashboard
        </Link>
      </div>
    </div>
  )
}
