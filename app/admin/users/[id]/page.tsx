'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Save, Trash2, Mail, Key } from 'lucide-react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Field from '@/components/ui/Field'
import ErrorBox from '@/components/ui/ErrorBox'
import ConfirmDialog from '@/components/ConfirmDialog'
import { ROLES, roleLabel } from '@/lib/roles'
import { displayUsername, displayCompany } from '@/lib/usernames'
import type { User, Subcontractor, UserRole } from '@/types'

type UserView = Omit<User, 'password'>

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [user, setUser] = useState<UserView | null>(null)
  const [subs, setSubs] = useState<Subcontractor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Editable fields
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('subcontractor')
  const [subcontractorId, setSubcontractorId] = useState<string>('')
  const [active, setActive] = useState(true)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Password reset (admin-set)
  const [newPassword, setNewPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [resetLinkMsg, setResetLinkMsg] = useState<string | null>(null)

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/users/${id}`).then(async (r) => r.ok ? r.json() : Promise.reject(await r.json())),
      fetch('/api/subcontractors').then((r) => r.ok ? r.json() : []),
    ])
      .then(([u, s]: [UserView, Subcontractor[]]) => {
        setUser(u)
        setSubs(Array.isArray(s) ? s : [])
        setFullName(u.full_name)
        setEmail(u.email)
        setRole(u.role)
        setSubcontractorId(u.subcontractor_id ?? '')
        setActive(u.active)
        setLoading(false)
      })
      .catch((err) => { setError(err?.error ?? 'Klarte ikke å laste bruker'); setLoading(false) })
  }, [id])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaved(false); setError(null); setSaving(true)
    const isAdminRole = role === 'main' || role === 'project_manager' || role === 'company'
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName,
        email,
        role,
        subcontractor_id: isAdminRole ? null : (subcontractorId || null),
        active,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setError(data.error ?? 'Lagring feilet'); return }
    setUser(data); setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError(null); setPwSuccess(false)
    if (newPassword.length < 8) { setPwError('Passord må være minst 8 tegn'); return }
    setPwSaving(true)
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    })
    setPwSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setPwError(d.error ?? 'Kunne ikke sette passord'); return
    }
    setPwSuccess(true); setNewPassword('')
    setTimeout(() => setPwSuccess(false), 2500)
  }

  async function handleSendResetLink() {
    if (!user) return
    setResetLinkMsg(null)
    let res: Response
    try {
      res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      })
    } catch {
      setResetLinkMsg('Nettverksfeil — prøv igjen')
      return
    }
    if (res.ok) {
      setResetLinkMsg(`Tilbakestillingslenke sendt til ${user.email}`)
      setTimeout(() => setResetLinkMsg(null), 4000)
    } else {
      const data = await res.json().catch(() => ({} as { error?: string }))
      setResetLinkMsg(data.error ?? 'Klarte ikke å sende lenken')
    }
  }

  async function handleDelete() {
    setDeleting(true)
    const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' })
    setDeleting(false)
    if (res.ok) router.push('/admin/users')
    else {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Sletting feilet')
      setConfirmDelete(false)
    }
  }

  if (loading) return <div className="p-6 text-sm text-[var(--color-text-muted)]">Laster...</div>
  if (error && !user) return (
    <div className="p-6 space-y-4">
      <Link href="/admin/users" className="text-sm text-primary hover:underline">← Tilbake</Link>
      <ErrorBox variant="error">{error}</ErrorBox>
    </div>
  )
  if (!user) return null

  const subPicked = subs.find((s) => s.id === subcontractorId) ?? null
  const username = displayUsername({ ...user, full_name: fullName, role }, subPicked)
  const company = displayCompany({ ...user, role }, subPicked)
  const isAdminRole = role === 'main' || role === 'project_manager' || role === 'company'

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft size={14} /> Alle brukere
        </Link>
        <span className="text-xs text-[var(--color-text-muted)] font-mono">ID: {user.id}</span>
      </div>

      <div>
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">{user.full_name}</h1>
        <p className="text-sm text-[var(--color-text-muted)] font-mono mt-0.5">{username}</p>
      </div>

      {error && <ErrorBox variant="error">{error}</ErrorBox>}

      <Card className="p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Bruker-info</h2>
        <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Fullt navn">
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="E-post">
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Brukernivå (rolle)">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="input"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Selskap (autoutledet)">
            <input value={company} readOnly className="input bg-muted text-[var(--color-text-muted)]" />
          </Field>
          {!isAdminRole && (
            <Field label="Knyttet til underentreprenør" className="sm:col-span-2">
              <select
                value={subcontractorId}
                onChange={(e) => setSubcontractorId(e.target.value)}
                className="input"
              >
                <option value="">– Ingen knytning –</option>
                {subs.map((s) => (
                  <option key={s.id} value={s.id}>{s.company_name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Status" className="sm:col-span-2">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="cursor-pointer"
              />
              <span className="text-sm">{active ? 'Aktiv — kan logge inn' : 'Inaktiv — innlogging blokkert, alle sesjoner slettes ved lagring'}</span>
            </label>
          </Field>
          <Field label="Brukernavn (autogenerert)" className="sm:col-span-2">
            <input value={username} readOnly className="input bg-muted text-[var(--color-text-muted)] font-mono text-xs" />
          </Field>
          <div className="sm:col-span-2 flex items-center justify-between pt-2">
            <Button type="submit" variant="primary" className="px-4 py-2 text-sm inline-flex items-center gap-1.5" disabled={saving}>
              <Save size={14} /> {saving ? 'Lagrer...' : 'Lagre endringer'}
            </Button>
            {saved && <span className="text-xs text-green-600">Lagret ✓</span>}
          </div>
        </form>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] inline-flex items-center gap-1.5">
          <Key size={14} /> Passord
        </h2>
        <p className="text-xs text-[var(--color-text-muted)]">
          Best praksis: send tilbakestillingslenke så brukeren setter sitt eget passord.
          Setter du passordet manuelt, må du gi det til brukeren på en sikker måte.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <button
            type="button"
            onClick={handleSendResetLink}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-muted hover:bg-gray-200 text-[var(--color-text-primary)] rounded-lg"
          >
            <Mail size={13} /> Send tilbakestillingslenke
          </button>
          <span className="text-xs text-[var(--color-text-muted)] hidden sm:inline">eller</span>
          <form onSubmit={handleSetPassword} className="flex-1 flex gap-2 items-stretch">
            <input
              type="password"
              placeholder="Sett nytt passord (min 8 tegn)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input flex-1"
            />
            <Button type="submit" variant="primary" className="px-3 py-2 text-xs" disabled={pwSaving || newPassword.length < 8}>
              {pwSaving ? 'Setter...' : 'Sett'}
            </Button>
          </form>
        </div>
        {resetLinkMsg && (
          <ErrorBox variant={resetLinkMsg.toLowerCase().includes('sendt') ? 'success' : 'error'}>
            {resetLinkMsg}
          </ErrorBox>
        )}
        {pwError && <ErrorBox variant="error">{pwError}</ErrorBox>}
        {pwSuccess && <ErrorBox variant="success">Passord oppdatert — alle sesjoner ble invalidert</ErrorBox>}
      </Card>

      <Card className="p-6 border-red-200 bg-red-50/30">
        <h2 className="text-sm font-semibold text-red-700">Slett bruker</h2>
        <p className="text-xs text-[var(--color-text-secondary)] mt-1 mb-3">
          Sletter brukeren permanent. Sesjoner avsluttes. Kan ikke angres.
        </p>
        <button
          onClick={() => setConfirmDelete(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium"
        >
          <Trash2 size={13} /> Slett bruker
        </button>
      </Card>

      {confirmDelete && (
        <ConfirmDialog
          title="Slett bruker?"
          message={`${user.full_name} (${user.email}) slettes permanent. Dette kan ikke angres.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      <style jsx>{`
        .input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          border: 1px solid var(--color-border);
          border-radius: 0.5rem;
          background: var(--color-bg-card);
          color: var(--color-text-primary);
        }
        .input:focus {
          outline: none;
          border-color: var(--color-primary);
        }
      `}</style>
    </div>
  )
}

// Field is imported from @/components/ui/Field — no local def needed.
