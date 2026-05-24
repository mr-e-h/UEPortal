'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'

/**
 * "Opprett P1-P4"-knapp for det gitte året. Posts til /api/forecast-periods
 * og refresher den server-renderede oversikten.
 */
export default function CreatePeriodsButton({ year }: { year: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handle() {
    setBusy(true)
    setError(null)
    let res: Response
    try {
      res = await fetch('/api/forecast-periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year }),
      })
    } catch {
      setBusy(false)
      setError('Nettverksfeil')
      return
    }
    setBusy(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }))
      setError(d.error ?? 'Klarte ikke å opprette periodene')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <Button variant="primary" className="px-4 py-2 text-sm" onClick={handle} disabled={busy}>
        {busy ? 'Oppretter...' : `Opprett P1-P4 for ${year}`}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
