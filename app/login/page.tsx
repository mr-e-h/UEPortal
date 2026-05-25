'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Field from '@/components/ui/Field'
import ErrorBox from '@/components/ui/ErrorBox'
import Button from '@/components/ui/Button'

type LoginResponse =
  | { id: string; role: 'company' | 'project_manager' | 'main' | 'sub'; full_name: string; subcontractor_id: string | null }
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
      : data.role === 'sub' ? '/subcontractor'
      : '/subcontractor'

    const safeRedirect = requestedRedirect && requestedRedirect.startsWith('/')
      && !requestedRedirect.startsWith('//')
      ? requestedRedirect
      : null
    const dest = safeRedirect ?? roleHome
    router.push(dest)
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat relative px-4"
      style={{ backgroundImage: 'url(/login-bg.webp)' }}
    >
      {/* White wash to soften the photo so the login card stays the focal point */}
      <div className="absolute inset-0 bg-white/40" aria-hidden="true" />

      {/* Grid-paper patches scattered around, same brand blue */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <pattern id="gridPaper" width="22" height="22" patternUnits="userSpaceOnUse">
            <path d="M 22 0 L 0 0 0 22" fill="none" stroke="#2563EB" strokeWidth="1" strokeOpacity="0.4" />
          </pattern>
        </defs>
        <rect x="60" y="90" width="190" height="140" fill="url(#gridPaper)" opacity="0.55" />
        <rect x="1320" y="140" width="220" height="160" fill="url(#gridPaper)" opacity="0.5" />
        <rect x="80" y="630" width="200" height="150" fill="url(#gridPaper)" opacity="0.45" />
        <rect x="1100" y="680" width="200" height="140" fill="url(#gridPaper)" opacity="0.55" />
        <rect x="780" y="40" width="150" height="100" fill="url(#gridPaper)" opacity="0.4" />
      </svg>
      <div className="max-w-md w-full space-y-8 p-8 bg-white/95 backdrop-blur-sm rounded-lg shadow-xl relative z-10">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Logg inn</h1>
          <p className="mt-2 text-sm text-gray-600">MinUE — underentreprenør-rapportering</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {error && <ErrorBox>{error}</ErrorBox>}

          <Field label="E-post">
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900"
            />
          </Field>

          <Field label="Passord">
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900"
            />
          </Field>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Logger inn...' : 'Logg inn'}
          </Button>

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
    desired_role: 'sub' as 'project_manager' | 'sub',
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
            <ErrorBox variant="success">
              Takk! Forespørselen er sendt. Du får e-post når en administrator har behandlet den.
            </ErrorBox>
            <Button type="button" onClick={onClose} className="w-full">
              Lukk
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && <ErrorBox>{error}</ErrorBox>}
            <Field label="Fullt navn *">
              <input
                required
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
              />
            </Field>
            <Field label="E-post *">
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Selskap">
                <input
                  value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
                />
              </Field>
              <Field label="Telefon">
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
                />
              </Field>
            </div>
            <Field label="Ønsket rolle">
              <select
                value={form.desired_role}
                onChange={(e) => setForm((f) => ({ ...f, desired_role: e.target.value as 'project_manager' | 'sub' }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
              >
                <option value="sub">Underentreprenør</option>
                <option value="project_manager">Prosjektleder</option>
              </select>
            </Field>
            <Field label="Melding">
              <textarea
                rows={3}
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder="Hvilke prosjekter, kontaktperson hos MinUE, eller annen relevant info"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 resize-none"
              />
            </Field>
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                Avbryt
              </Button>
              <Button type="submit" disabled={submitting} className="flex-1">
                {submitting ? 'Sender...' : 'Send forespørsel'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
