'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type Status = 'loading' | 'valid' | 'invalid' | 'success'

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()

  const [status, setStatus] = useState<Status>('loading')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data: { valid: boolean }) => setStatus(data.valid ? 'valid' : 'invalid'))
      .catch(() => setStatus('invalid'))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Passord må være minst 8 tegn')
      return
    }
    if (password !== confirm) {
      setError('Passordene stemmer ikke overens')
      return
    }

    setSubmitting(true)
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
    setSubmitting(false)

    if (res.ok) {
      setStatus('success')
      setTimeout(() => router.push('/login'), 1500)
    } else {
      const data = await res.json().catch(() => ({ error: 'Ukjent feil' }))
      setError(data.error ?? 'Tilbakestilling feilet')
      if (res.status === 400) setStatus('invalid')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-page)] px-4">
      <div className="w-full max-w-sm bg-card rounded-xl border border-border p-8 shadow-sm">
        <div className="border-t-4 border-primary -mt-8 -mx-8 mb-6 rounded-t-xl" />
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Velg nytt passord</h1>

        {status === 'loading' && (
          <p className="mt-6 text-sm text-[var(--color-text-muted)]">Sjekker lenke...</p>
        )}

        {status === 'invalid' && (
          <div className="mt-6 space-y-4">
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-3">
              Lenken er ugyldig eller utløpt. Tilbakestillingslenker er gyldige i 1 time og kan kun brukes én gang.
            </div>
            <Link href="/forgot-password" className="block text-sm text-primary hover:underline">
              Be om ny lenke →
            </Link>
          </div>
        )}

        {status === 'success' && (
          <div className="mt-6 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-3">
            Passord oppdatert. Sender deg til innlogging...
          </div>
        )}

        {status === 'valid' && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Nytt passord (minst 8 tegn)
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Bekreft passord
              </label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Lagrer...' : 'Sett nytt passord'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
