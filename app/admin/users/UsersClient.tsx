'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Pencil, Mail, X, Search, Download, Trash2, PowerOff, Power } from 'lucide-react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Field from '@/components/ui/Field'
import ErrorBox from '@/components/ui/ErrorBox'
import StatusPill from '@/components/ui/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import { roleLabel } from '@/lib/roles'
import { displayCompany } from '@/lib/usernames'
import { useMe } from '@/lib/useMe'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { UserRole } from '@/types'

const SUPER_ADMIN_EMAIL = 'mhelsing94@gmail.com'

export type SafeUser = {
  id: string
  email: string
  full_name: string
  role: UserRole
  subcontractor_id: string | null
  active: boolean
}

export type SubcontractorLite = {
  id: string
  company_name: string
}

export type InvitationLite = {
  id: string
  email: string
  role: 'project_manager' | 'sub'
  expires_at: string
  accepted_at: string | null
}

type SortKey = 'full_name' | 'email' | 'role' | 'id' | 'active' | 'company'
type SortDir = 'asc' | 'desc'

interface Props {
  initialUsers: SafeUser[]
  subcontractors: SubcontractorLite[]
  initialInvitations: InvitationLite[]
}

export default function UsersClient({ initialUsers, subcontractors, initialInvitations }: Props) {
  const router = useRouter()
  const { me } = useMe()

  // Data ships with the server-rendered HTML; no loading state on first paint.
  // We re-fetch invitations after creating a new one, and optimistically
  // remove rows from `users` after a delete (then router.refresh() to keep
  // server-rendered sibling badges in sync).
  const [users, setUsers] = useState<SafeUser[]>(initialUsers)
  const [invitations, setInvitations] = useState<InvitationLite[]>(initialInvitations)
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'one'; user: SafeUser } | { kind: 'bulk'; ids: string[] } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('full_name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({
    email: '',
    role: 'sub' as 'project_manager' | 'sub',
  })
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  async function loadInvitations() {
    const inv = await fetch('/api/invitations').then((r) => r.ok ? r.json() : [])
    setInvitations(Array.isArray(inv) ? inv : [])
  }

  async function revokeInvitation(id: string, email: string) {
    if (!confirm(`Trekke tilbake invitasjonen til ${email}? Den eksisterende lenken slutter å fungere umiddelbart.`)) return
    const res = await fetch(`/api/admin/invitations/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(data.error ?? 'Kunne ikke trekke tilbake invitasjonen')
      return
    }
    // Optimistic local update so the row disappears without a round-trip.
    setInvitations((prev) => prev.filter((i) => i.id !== id))
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
    setInviteForm({ email: '', role: 'sub' })
    loadInvitations()
  }

  function canDelete(u: SafeUser): boolean {
    if (u.email === SUPER_ADMIN_EMAIL) return false
    if (me && u.id === me.real_id) return false
    return true
  }

  // Same guard as delete: super-admin and self can't be locked out.
  // (Locking yourself out from the admin UI would immediately invalidate
  // the cookie running the request and be confusing; deactivating super-
  // admin would lose the only view-as-capable account.)
  function canToggleActive(u: SafeUser): boolean {
    if (u.email === SUPER_ADMIN_EMAIL) return false
    if (me && u.id === me.real_id) return false
    return true
  }

  async function toggleActive(u: SafeUser): Promise<void> {
    const next = !u.active
    // Optimistic flip so the click feels instant; revert + alert on failure.
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, active: next } : x)))
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: next }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, active: u.active } : x)))
      alert(data.error ?? 'Kunne ikke endre status')
      return
    }
    // Server cleared the user's sessions on deactivation already; refresh
    // server-rendered siblings so badges/lists pick up the new state.
    router.refresh()
  }

  async function bulkSetActive(ids: string[], next: boolean): Promise<void> {
    if (ids.length === 0) return
    const failures: string[] = []
    for (const id of ids) {
      const target = users.find((u) => u.id === id)
      if (!target || !canToggleActive(target)) continue
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: next }),
      })
      if (res.ok) {
        setUsers((prev) => prev.map((x) => (x.id === id ? { ...x, active: next } : x)))
      } else {
        const data = await res.json().catch(() => ({}))
        failures.push(`${target.full_name}: ${data.error ?? 'feilet'}`)
      }
    }
    router.refresh()
    if (failures.length > 0) alert('Noen ble ikke endret:\n' + failures.join('\n'))
  }

  async function performDelete(ids: string[]): Promise<void> {
    if (deleting || ids.length === 0) return
    setDeleting(true)
    // Sequential delete — keeps server load steady and lets us bail on the
    // first failure with a sensible error.
    const failures: string[] = []
    for (const id of ids) {
      const res = await fetch(`/api/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const target = users.find((u) => u.id === id)
        failures.push(`${target?.full_name ?? id}: ${data.error ?? 'feilet'}`)
      }
    }
    setDeleting(false)
    setConfirmDelete(null)
    const deletedIds = new Set(ids.filter((id) => !failures.some((f) => f.startsWith(users.find((u) => u.id === id)?.full_name ?? id))))
    if (deletedIds.size > 0) {
      setUsers((prev) => prev.filter((u) => !deletedIds.has(u.id)))
      setSelected((prev) => {
        const next = new Set(prev)
        deletedIds.forEach((id) => next.delete(id))
        return next
      })
      router.refresh()
    }
    if (failures.length > 0) alert('Noen ble ikke slettet:\n' + failures.join('\n'))
  }

  const subMap = useMemo(() => new Map(subcontractors.map((s) => [s.id, s])), [subcontractors])
  const pendingInvitations = invitations.filter((i) => i.accepted_at === null && new Date(i.expires_at) > new Date())

  const enriched = useMemo(() => users.map((u) => {
    const sub = u.subcontractor_id ? subMap.get(u.subcontractor_id) ?? null : null
    return {
      ...u,
      company: displayCompany(u, sub),
    }
  }), [users, subMap])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return enriched
    return enriched.filter((u) =>
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.company.toLowerCase().includes(q) ||
      u.id.toLowerCase().includes(q)
    )
  }, [enriched, search])

  const sorted = useMemo(() => {
    const out = [...filtered]
    out.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      const get = (x: typeof a): string | number | boolean => {
        if (sortKey === 'full_name') return x.full_name
        if (sortKey === 'email') return x.email
        if (sortKey === 'role') return roleLabel(x.role)
        if (sortKey === 'id') return x.id
        if (sortKey === 'active') return x.active ? 1 : 0
        return x.company
      }
      const av = get(a), bv = get(b)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
    return out
  }, [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function toggleSelect(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleSelectAll() {
    if (selected.size === sorted.length) setSelected(new Set())
    else setSelected(new Set(sorted.map((u) => u.id)))
  }

  function exportCsv() {
    const headers = ['Navn', 'E-post', 'Brukernivå', 'BrukerId', 'Status', 'Selskap']
    const rows = sorted.map((u) => [
      u.full_name, u.email, roleLabel(u.role), u.id,
      u.active ? 'Aktiv' : 'Inaktiv', u.company,
    ])
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`
    const csv = [headers, ...rows].map((r) => r.map((c) => escape(String(c))).join(',')).join('\r\n')
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `brukere-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Brukere</h1>
        <div className="flex items-center gap-2">
          <Button variant="primary" className="px-3 py-1.5 text-xs flex items-center gap-1.5" onClick={() => setShowInvite((v) => !v)}>
            <Mail size={13} /> Inviter bruker
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
            Mottakeren får e-post med lenke for å sette passord og opprette kontoen sin. Lenken er gyldig i 7 dager.
          </p>
          <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {inviteError && <div className="sm:col-span-2"><ErrorBox>{inviteError}</ErrorBox></div>}
            {inviteSuccess && <div className="sm:col-span-2"><ErrorBox variant="success">{inviteSuccess}</ErrorBox></div>}
            <Field label="E-post">
              <input
                required
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
              />
            </Field>
            <Field label="Rolle">
              <select
                value={inviteForm.role}
                onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value as 'project_manager' | 'sub' }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
              >
                <option value="sub">Underentreprenør</option>
                <option value="project_manager">Prosjektleder</option>
              </select>
            </Field>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setShowInvite(false)}>Lukk</Button>
              <Button type="submit" variant="primary" className="px-3 py-1.5 text-xs" disabled={inviting}>
                {inviting ? 'Sender...' : 'Send invitasjon'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk i navn, e-post, selskap, ID..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <span>{sorted.length} {sorted.length === 1 ? 'bruker' : 'brukere'}</span>
            {selected.size > 0 && <span className="text-primary">· {selected.size} valgt</span>}
          </div>
          {selected.size > 0 && (() => {
            const selectedUsers = Array.from(selected)
              .map((id) => users.find((u) => u.id === id))
              .filter((u): u is SafeUser => !!u)
            const togglable = selectedUsers.filter(canToggleActive)
            const toDeactivate = togglable.filter((u) => u.active).map((u) => u.id)
            const toActivate = togglable.filter((u) => !u.active).map((u) => u.id)
            const deletable = selectedUsers.filter(canDelete).map((u) => u.id)
            return (
              <>
                {toDeactivate.length > 0 && (
                  <button
                    onClick={() => bulkSetActive(toDeactivate, false)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium"
                  >
                    <PowerOff size={13} /> Steng ute {toDeactivate.length}
                  </button>
                )}
                {toActivate.length > 0 && (
                  <button
                    onClick={() => bulkSetActive(toActivate, true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
                  >
                    <Power size={13} /> Aktiver {toActivate.length}
                  </button>
                )}
                <button
                  onClick={() => setConfirmDelete({ kind: 'bulk', ids: deletable })}
                  disabled={deletable.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  title={deletable.length === 0 ? 'Ingen av de valgte kan slettes (super-admin / deg selv)' : undefined}
                >
                  <Trash2 size={13} /> Slett {deletable.length} valgte
                </button>
              </>
            )
          })()}
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-gray-200 text-[var(--color-text-primary)] rounded-lg font-medium"
          >
            <Download size={13} /> Eksporter CSV
          </button>
        </div>

        <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-3 py-2.5 text-left w-12">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={sorted.length > 0 && selected.size === sorted.length}
                        onChange={toggleSelectAll}
                        className="cursor-pointer"
                      />
                      <span className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase">Endre</span>
                    </div>
                  </th>
                  <Th label="Navn" sortKey="full_name" current={sortKey} dir={sortDir} onSort={toggleSort} />
                  <Th label="E-post" sortKey="email" current={sortKey} dir={sortDir} onSort={toggleSort} />
                  <Th label="Brukernivå" sortKey="role" current={sortKey} dir={sortDir} onSort={toggleSort} />
                  <Th label="BrukerId" sortKey="id" current={sortKey} dir={sortDir} onSort={toggleSort} />
                  <Th label="Status" sortKey="active" current={sortKey} dir={sortDir} onSort={toggleSort} />
                  <Th label="Selskap" sortKey="company" current={sortKey} dir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => router.push(`/admin/users/${u.id}`)}
                    className="border-b border-border last:border-0 hover:bg-muted transition-colors cursor-pointer"
                  >
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected.has(u.id)}
                          onChange={() => toggleSelect(u.id)}
                          className="cursor-pointer"
                        />
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="text-[var(--color-text-muted)] hover:text-primary"
                          title="Rediger bruker"
                        >
                          <Pencil size={13} />
                        </Link>
                        {canToggleActive(u) && (
                          <button
                            type="button"
                            onClick={() => toggleActive(u)}
                            className={u.active
                              ? 'text-[var(--color-text-muted)] hover:text-amber-600'
                              : 'text-amber-500 hover:text-green-600'}
                            title={u.active ? 'Steng ute (sett inaktiv)' : 'Aktiver bruker'}
                          >
                            {u.active ? <PowerOff size={13} /> : <Power size={13} />}
                          </button>
                        )}
                        {canDelete(u) && (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete({ kind: 'one', user: u })}
                            className="text-[var(--color-text-muted)] hover:text-red-600"
                            title="Slett bruker"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-[var(--color-text-primary)]">{u.full_name}</td>
                    <td className="px-3 py-2.5 text-[var(--color-text-secondary)] text-xs">{u.email}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill tone={u.role === 'main' || u.role === 'project_manager' || u.role === 'company' ? 'blue' : 'amber'}>
                        {roleLabel(u.role)}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--color-text-muted)] font-mono text-xs">{u.id.slice(0, 8)}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill tone={u.active ? 'green' : 'gray'}>
                        {u.active ? 'Aktiv' : 'Av'}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">{u.company}</td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        title={search ? 'Ingen treff' : 'Ingen brukere'}
                        description={search ? 'Juster søket eller fjern filteret.' : 'Inviter første bruker via knappen øverst.'}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
                  {['E-post', 'Rolle', 'Utløper', ''].map((h) => (
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
                    <td className="px-6 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => revokeInvitation(i.id, i.email)}
                        className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
                      >
                        Trekk tilbake
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {confirmDelete?.kind === 'one' && (
        <ConfirmDialog
          title="Slett bruker?"
          message={`${confirmDelete.user.full_name} (${confirmDelete.user.email}) slettes permanent. Alle sesjoner avsluttes og PM-tildelinger fjernes. Kan ikke angres.`}
          confirmLabel={deleting ? 'Sletter...' : 'Slett'}
          onConfirm={() => performDelete([confirmDelete.user.id])}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmDelete?.kind === 'bulk' && (
        <ConfirmDialog
          title={`Slett ${confirmDelete.ids.length} brukere?`}
          message="Alle valgte brukere slettes permanent. Sesjoner avsluttes og PM-tildelinger fjernes. Super-admin og din egen bruker er utelatt fra utvalget. Kan ikke angres."
          confirmLabel={deleting ? 'Sletter...' : 'Slett alle'}
          onConfirm={() => performDelete(confirmDelete.ids)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

function Th({ label, sortKey, current, dir, onSort }: {
  label: string
  sortKey: SortKey
  current: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
}) {
  const active = current === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="px-3 py-2.5 text-left text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide cursor-pointer select-none hover:text-[var(--color-text-primary)]"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span className="text-primary">{dir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  )
}
