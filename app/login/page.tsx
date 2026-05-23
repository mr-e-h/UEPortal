'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

type LoginResponse =
  | { id: string; role: 'company' | 'project_manager' | 'subcontractor' | 'main' | 'sub'; full_name: string; subcontractor_id: string | null }
  | { error: string }

// useSearchParams() forces a CSR bailout under static prerender (Next 14).
// Wrap in Suspense with a minimal fallback so the build succeeds — the real
// form mounts on the client a tick later. The fallback must NOT itself call
// useSearchParams (would infinite-bail).
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Laster...</div>}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // The middleware sets ?redirect=<original-path> when bouncing an
  // unauthenticated request. Honor it so deep links survive the login round-trip.
  const requestedRedirect = searchParams.get('redirect')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [showRequest, setShowRequest] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    let res: Response
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    } catch {
      setError('Nettverksfeil — sjekk forbindelsen og prøv igjen')
      setLoading(false)
      return
    }

    // .json() can throw on empty/non-JSON bodies; coerce to a typed object.
    const data = await res.json().catch(() => ({})) as LoginResponse | Record<string, never>

    if (!res.ok || 'error' in data) {
      const msg = 'error' in data && typeof data.error === 'string' ? data.error : 'Innlogging feilet'
      setError(msg)
      setLoading(false)
      return
    }

    // Resolve destination — honor ?redirect= only when it points at an internal
    // path (open-redirect prevention) and matches the user's role tree.
    // company → /admin until the dedicated /company portal exists.
    const roleHome = (data.role === 'project_manager' || data.role === 'main' || data.role === 'company') ? '/admin'
      : (data.role === 'subcontractor' || data.role === 'sub') ? '/subcontractor'
      : '/subcontractor'

    const safeRedirect = requestedRedirect && requestedRedirect.startsWith('/')
      && !requestedRedirect.startsWith('//')
      ? requestedRedirect
      : null
    const dest = safeRedirect ?? roleHome
    router.push(dest)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Logg inn</h1>
          <p className="mt-2 text-sm text-gray-600">Underentreprenør-rapportering</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-700 bg-red-50 rounded border border-red-200">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              E-post
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Passord
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Logger inn...' : 'Logg inn'}
          </button>

          <div className="flex items-center justify-between text-sm">
            <Link href="/forgot-password" className="text-gray-600 hover:text-blue-600 hover:underline">
              Glemt passord?
            </Link>
            <button
              type="button"
              onClick={() => setShowRequest(true)}
              className="text-gray-600 hover:text-blue-600 hover:underline"
            >
              Be om tilgang
            </button>
          </div>
        </form>
      </div>

      {showRequest && <RequestAccessModal onClose={() => setShowRequest(false)} />}
    </div>
  )
}

function RequestAccessModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    company: '',
    phone: '',
    desired_role: 'subcontractor' as 'project_manager' | 'subcontractor',
    message: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await fetch('/api/access-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSubmitting(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Kunne ikke sende forespørselen, prøv igjen senere')
      return
    }
    setDone(true)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-lg max-w-md w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Be om tilgang</h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Fyll ut skjemaet, så vil en administrator vurdere forespørselen.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label="Lukk">×</button>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              Takk! Forespørselen er sendt. Du får e-post når en administrator har behandlet den.
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
            >
              Lukk
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Fullt navn *</label>
              <input
                required
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">E-post *</label>
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Selskap</label>
                <input
                  value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Telefon</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Ønsket rolle</label>
              <select
                value={form.desired_role}
                onChange={(e) => setForm((f) => ({ ...f, desired_role: e.target.value as 'project_manager' | 'subcontractor' }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
              >
                <option value="subcontractor">Underentreprenør</option>
                <option value="project_manager">Prosjektleder</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Melding</label>
              <textarea
                rows={3}
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder="Hvilke prosjekter, kontaktperson hos Netel, eller annen relevant info"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 resize-none"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 px-4 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                Avbryt
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 py-2 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                {submitting ? 'Sender...' : 'Send forespørsel'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
