'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    // Endpoint always returns 200 (account enumeration protection),
    // so we don't need to inspect the response — just show the confirmation.
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => {})
    setSubmitting(false)
    setDone(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-page)] px-4">
      <div className="w-full max-w-sm bg-card rounded-xl border border-border p-8 shadow-sm">
        <div className="border-t-4 border-primary -mt-8 -mx-8 mb-6 rounded-t-xl" />
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Glemt passord</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Skriv inn e-postadressen din. Hvis vi finner kontoen, sender vi en lenke for å sette nytt passord.
        </p>

        {done ? (
          <div className="mt-6 space-y-4">
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-3">
              Hvis e-postadressen er registrert, har vi sendt deg en lenke. Sjekk innboksen (og spam-mappen). Lenken er gyldig i 1 time.
            </div>
            <Link href="/login" className="block text-sm text-primary hover:underline">
              ← Tilbake til innlogging
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">E-post</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Sender...' : 'Send tilbakestillingslenke'}
            </button>
            <Link href="/login" className="block text-sm text-[var(--color-text-muted)] hover:text-primary text-center">
              Tilbake til innlogging
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}
