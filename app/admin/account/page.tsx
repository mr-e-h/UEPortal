'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { roleLabel } from '@/lib/roles'

const RESET_CONFIRMATION = 'RESET-SYSTEM'

export default function AccountPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')

  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  const [showResetDialog, setShowResetDialog] = useState(false)
  const [resetText, setResetText] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    setName(localStorage.getItem('user_name') ?? '')
    setEmail(localStorage.getItem('user_id') ?? '')
    setRole(localStorage.getItem('user_role') ?? '')

    const id = localStorage.getItem('user_id')
    if (id) {
      fetch('/api/users')
        .then((r) => r.json())
        .then((users: { id: string; email: string }[]) => {
          const me = users.find((u) => u.id === id)
          if (me) setEmail(me.email)
        })
        .catch(() => {})
    }
  }, [])

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError(null)
    setPwSuccess(false)

    if (newPw !== confirmPw) {
      setPwError('Passordene stemmer ikke overens')
      return
    }
    if (newPw.length < 6) {
      setPwError('Passord må være minst 6 tegn')
      return
    }

    setSaving(true)
    const res = await fetch('/api/account/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
    })
    setSaving(false)

    if (res.ok) {
      setPwSuccess(true)
      setOldPw('')
      setNewPw('')
      setConfirmPw('')
    } else {
      const data = await res.json()
      setPwError(data.error ?? 'Feil ved passordendring')
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setResetError(null)
    if (resetText !== RESET_CONFIRMATION) {
      setResetError(`Skriv ${RESET_CONFIRMATION} for å bekrefte`)
      return
    }
    setResetting(true)
    const res = await fetch('/api/admin/reset-system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: RESET_CONFIRMATION }),
    })
    setResetting(false)
    if (res.ok) {
      // Keep just the admin's identity in localStorage; clear anything UE-related.
      const keep = {
        user_id: localStorage.getItem('user_id'),
        user_name: localStorage.getItem('user_name'),
        user_role: localStorage.getItem('user_role'),
      }
      localStorage.clear()
      if (keep.user_id) localStorage.setItem('user_id', keep.user_id)
      if (keep.user_name) localStorage.setItem('user_name', keep.user_name)
      if (keep.user_role) localStorage.setItem('user_role', keep.user_role)
      router.push('/admin?reset=ok')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({ error: 'Ukjent feil' }))
      setResetError(data.error ?? 'Reset feilet')
    }
  }

  const isMainAdmin = role === 'main'

  return (
    <div className="p-6 space-y-6 max-w-xl">
      <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Min konto</h1>

      <Card className="p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Profilinformasjon</h2>
        <div className="space-y-3">
          <div>
            <p className="text-xs text-[var(--color-text-muted)] mb-0.5">Navn</p>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{name || '–'}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)] mb-0.5">E-post</p>
            <p className="text-sm text-[var(--color-text-secondary)]">{email || '–'}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)] mb-0.5">Rolle</p>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
              {roleLabel(role)}
            </span>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">Endre passord</h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          {pwError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{pwError}</div>
          )}
          {pwSuccess && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              Passord oppdatert
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Nåværende passord</label>
            <input
              type="password"
              required
              value={oldPw}
              onChange={(e) => setOldPw(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Nytt passord</label>
            <input
              type="password"
              required
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Bekreft nytt passord</label>
            <input
              type="password"
              required
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="pt-1">
            <Button type="submit" variant="primary" className="px-4 py-2 text-sm" disabled={saving}>
              {saving ? 'Lagrer...' : 'Oppdater passord'}
            </Button>
          </div>
        </form>
      </Card>

      {isMainAdmin && (
        <Card className="p-6 border-red-200 bg-red-50/30">
          <h2 className="text-sm font-semibold text-red-700">Farlig sone</h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1 mb-4">
            Nullstilling sletter alle prosjekter, rapporter, EM, milepæler, fakturaer, prognoser,
            brukere (utenom deg), underentreprenører, produkter, time-typer og vedlegg. Du blir
            stående igjen som eneste bruker. <strong>Kan ikke angres.</strong>
          </p>
          {!showResetDialog ? (
            <button
              onClick={() => setShowResetDialog(true)}
              className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium"
            >
              Nullstill systemet
            </button>
          ) : (
            <form onSubmit={handleReset} className="space-y-3">
              {resetError && (
                <div className="text-sm text-red-700 bg-red-100 border border-red-300 rounded px-3 py-2">
                  {resetError}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-red-700 mb-1">
                  Skriv <code className="bg-red-100 px-1 rounded">{RESET_CONFIRMATION}</code> for å bekrefte:
                </label>
                <input
                  type="text"
                  value={resetText}
                  onChange={(e) => setResetText(e.target.value)}
                  autoComplete="off"
                  className="w-full px-3 py-2 text-sm border border-red-300 rounded-lg bg-white text-[var(--color-text-primary)] focus:outline-none focus:border-red-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={resetting || resetText !== RESET_CONFIRMATION}
                  className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {resetting ? 'Nullstiller...' : 'Bekreft nullstilling'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowResetDialog(false); setResetText(''); setResetError(null) }}
                  className="px-3 py-1.5 text-xs bg-muted hover:bg-gray-200 text-[var(--color-text-primary)] rounded-lg font-medium"
                >
                  Avbryt
                </button>
              </div>
            </form>
          )}
        </Card>
      )}
    </div>
  )
}
