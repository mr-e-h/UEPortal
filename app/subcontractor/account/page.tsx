'use client'

import { useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Field from '@/components/ui/Field'
import ErrorBox from '@/components/ui/ErrorBox'
import FormCard from '@/components/ui/FormCard'
import { roleLabel } from '@/lib/roles'
import { useMe } from '@/lib/useMe'

/**
 * Subcontractor account page: read-only profile + change password.
 * Mirrors /admin/account but without the system-reset danger zone.
 */
export default function SubcontractorAccountPage() {
  const { me, loading } = useMe()

  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError(null)
    setPwSuccess(false)

    if (newPw !== confirmPw) {
      setPwError('Passordene stemmer ikke overens')
      return
    }
    if (newPw.length < 8) {
      setPwError('Passord må være minst 8 tegn')
      return
    }

    setSaving(true)
    let res: Response
    try {
      res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
      })
    } catch {
      setSaving(false)
      setPwError('Nettverksfeil — prøv igjen')
      return
    }
    setSaving(false)

    if (res.ok) {
      setPwSuccess(true)
      setOldPw('')
      setNewPw('')
      setConfirmPw('')
      return
    }
    const data = await res.json().catch(() => ({} as { error?: string }))
    setPwError(data.error ?? 'Feil ved passordendring')
  }

  if (loading || !me) {
    return <div className="p-6 text-sm text-[var(--color-text-muted)]">Laster...</div>
  }

  return (
    <div className="p-6 space-y-6 max-w-xl">
      <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Min konto</h1>

      <Card className="p-6 space-y-3">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Profilinformasjon</h2>
        <div>
          <p className="text-xs text-[var(--color-text-muted)] mb-0.5">Navn</p>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">{me.full_name || '–'}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-muted)] mb-0.5">E-post</p>
          <p className="text-sm text-[var(--color-text-secondary)]">{me.email || '–'}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-muted)] mb-0.5">Rolle</p>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
            {roleLabel(me.role)}
          </span>
        </div>
      </Card>

      <FormCard title="Endre passord">
        <form onSubmit={handleChangePassword} className="space-y-3">
          {pwError && <ErrorBox variant="error">{pwError}</ErrorBox>}
          {pwSuccess && <ErrorBox variant="success">Passord oppdatert</ErrorBox>}
          <Field label="Nåværende passord">
            <input
              type="password"
              required
              value={oldPw}
              onChange={(e) => setOldPw(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>
          <Field label="Nytt passord (min 8 tegn)">
            <input
              type="password"
              required
              minLength={8}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>
          <Field label="Bekreft nytt passord">
            <input
              type="password"
              required
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>
          <div className="pt-1">
            <Button type="submit" variant="primary" className="px-4 py-2 text-sm" disabled={saving}>
              {saving ? 'Lagrer...' : 'Oppdater passord'}
            </Button>
          </div>
        </form>
      </FormCard>
    </div>
  )
}
