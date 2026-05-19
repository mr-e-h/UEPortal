'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { Trash2, Plus, X, Mail } from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { roleLabel } from '@/lib/roles'

type SafeUser = {
  id: string
  email: string
  full_name: string
  role: string
  subcontractor_id: string | null
}

type Subcontractor = {
  id: string
  company_name: string
}

type Invitation = {
  id: string
  email: string
  role: 'project_manager' | 'subcontractor'
  expires_at: string
  accepted_at: string | null
}

export default function UsersPage() {
  const [users, setUsers] = useState<SafeUser[]>([])
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [form, setForm] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'sub' as 'main' | 'sub',
    subcontractor_id: '',
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [inviteForm, setInviteForm] = useState({
    email: '',
    role: 'subcontractor' as 'project_manager' | 'subcontractor',
  })
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  async function loadInvitations() {
    const inv = await fetch('/api/invitations').then((r) => r.ok ? r.json() : [])
    setInvitations(Array.isArray(inv) ? inv : [])
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/users').then((r) => r.json()),
      fetch('/api/subcontractors').then((r) => r.json()),
      fetch('/api/invitations').then((r) => r.ok ? r.json() : []),
    ]).then(([u, s, inv]) => {
      setUsers(u)
      setSubcontractors(s)
      setInvitations(Array.isArray(inv) ? inv : [])
      setLoading(false)
    })
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSaving(true)
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        subcontractor_id: form.role === 'sub' ? form.subcontractor_id || null : null,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setFormError(data.error ?? 'Feil ved oppretting')
      return
    }
    setUsers((prev) => [...prev, data])
    setShowForm(false)
    setForm({ email: '', password: '', full_name: '', role: 'sub', subcontractor_id: '' })
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)
    setInviteSuccess(null)
    setInviting(true)
    const res = await fetch('/api/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inviteForm),
    })
    const data = await res.json()
    setInviting(false)
    if (!res.ok) {
      setInviteError(data.error ?? 'Kunne ikke sende invitasjon')
      return
    }
    setInviteSuccess(`Invitasjon sendt til ${inviteForm.email}`)
    setInviteForm({ email: '', role: 'subcontractor' })
    loadInvitations()
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    await fetch(`/api/users?id=${id}`, { method: 'DELETE' })
    setUsers((prev) => prev.filter((u) => u.id !== id))
    setDeleting(null)
    setConfirmDeleteId(null)
  }

  const subMap = new Map(subcontractors.map((s) => [s.id, s.company_name]))
  const pendingInvitations = invitations.filter((i) => i.accepted_at === null && new Date(i.expires_at) > new Date())

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Brukere</h1>
        <div className="flex items-center gap-2">
          <Button variant="primary" className="px-3 py-1.5 text-xs flex items-center gap-1.5" onClick={() => { setShowInvite(true); setShowForm(false) }}>
            <Mail size={13} />
            Inviter bruker
          </Button>
          <Button variant="secondary" className="px-3 py-1.5 text-xs flex items-center gap-1.5" onClick={() => { setShowForm(true); setShowInvite(false) }}>
            <Plus size={13} />
            Opprett direkte
          </Button>
        </div>
      </div>

      {showInvite && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Inviter bruker via e-post</h2>
            <button onClick={() => setShowInvite(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
              <X size={16} />
            </button>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mb-4">
            Mottakeren får en e-post med lenke for å sette passord og opprette kontoen sin. Lenken er gyldig i 7 dager.
          </p>
          <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {inviteError && (
              <div className="sm:col-span-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                {inviteError}
              </div>
            )}
            {inviteSuccess && (
              <div className="sm:col-span-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                {inviteSuccess}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">E-post</label>
              <input
                required
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Rolle</label>
              <select
                value={inviteForm.role}
                onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value as 'project_manager' | 'subcontractor' }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
              >
                <option value="subcontractor">Underentreprenør</option>
                <option value="project_manager">Prosjektleder</option>
              </select>
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setShowInvite(false)}>
                Lukk
              </Button>
              <Button type="submit" variant="primary" className="px-3 py-1.5 text-xs" disabled={inviting}>
                {inviting ? 'Sender...' : 'Send invitasjon'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {showForm && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Opprett bruker direkte</h2>
            <button onClick={() => setShowForm(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
              <X size={16} />
            </button>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mb-4">
            Brukeren får ikke e-post. Du må selv gi dem passordet på en sikker måte. Foretrekk &quot;Inviter bruker&quot;.
          </p>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {formError && (
              <div className="sm:col-span-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formError}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Navn</label>
              <input
                required
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">E-post</label>
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Passord</label>
              <input
                required
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Rolle</label>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as 'main' | 'sub', subcontractor_id: '' }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
              >
                <option value="main">Admin (main)</option>
                <option value="sub">Underentreprenør (sub)</option>
              </select>
            </div>
            {form.role === 'sub' && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Underentreprenør</label>
                <select
                  value={form.subcontractor_id}
                  onChange={(e) => setForm((f) => ({ ...f, subcontractor_id: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
                >
                  <option value="">– Ingen knytning –</option>
                  {subcontractors.map((s) => (
                    <option key={s.id} value={s.id}>{s.company_name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setShowForm(false)}>
                Avbryt
              </Button>
              <Button type="submit" variant="primary" className="px-3 py-1.5 text-xs" disabled={saving}>
                {saving ? 'Lagrer...' : 'Opprett'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Alle brukere</h2>
        </div>
        {loading ? (
          <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Laster...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Navn', 'E-post', 'Rolle', 'Underentreprenør', ''].map((h) => (
                    <th
                      key={h}
                      className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted transition-colors">
                    <td className="px-6 py-3 font-medium text-[var(--color-text-primary)]">{u.full_name}</td>
                    <td className="px-6 py-3 text-[var(--color-text-secondary)]">{u.email}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        u.role === 'main' || u.role === 'project_manager'
                          ? 'bg-blue-50 text-blue-700'
                          : u.role === 'sub' || u.role === 'subcontractor'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-[var(--color-text-secondary)]">
                      {u.subcontractor_id ? subMap.get(u.subcontractor_id) ?? u.subcontractor_id : '–'}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={() => setConfirmDeleteId(u.id)}
                        disabled={deleting === u.id}
                        className="text-[var(--color-text-muted)] hover:text-danger transition-colors disabled:opacity-40"
                        title="Slett bruker"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-sm text-[var(--color-text-muted)]">
                      Ingen brukere
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pendingInvitations.length > 0 && (
        <Card>
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Ventende invitasjoner</h2>
            <span className="bg-primary text-white text-xs font-medium px-1.5 py-0.5 rounded-full">
              {pendingInvitations.length}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['E-post', 'Rolle', 'Utløper'].map((h) => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingInvitations.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <td className="px-6 py-3 text-[var(--color-text-primary)]">{i.email}</td>
                    <td className="px-6 py-3 text-[var(--color-text-secondary)]">{roleLabel(i.role)}</td>
                    <td className="px-6 py-3 text-[var(--color-text-muted)]">
                      {new Date(i.expires_at).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Slett bruker?"
          message="Brukeren slettes permanent. Dette kan ikke angres."
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  )
}
