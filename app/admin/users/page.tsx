'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Pencil, Mail, X, Search, Download } from 'lucide-react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { roleLabel } from '@/lib/roles'
import { displayUsername, displayCompany } from '@/lib/usernames'
import type { UserRole } from '@/types'

type SafeUser = {
  id: string
  email: string
  full_name: string
  role: UserRole
  subcontractor_id: string | null
  active: boolean
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

type SortKey = 'full_name' | 'username' | 'role' | 'id' | 'active' | 'company'
type SortDir = 'asc' | 'desc'

export default function UsersPage() {
  const router = useRouter()

  const [users, setUsers] = useState<SafeUser[]>([])
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('full_name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const [showInvite, setShowInvite] = useState(false)
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

  const subMap = useMemo(() => new Map(subcontractors.map((s) => [s.id, s])), [subcontractors])
  const pendingInvitations = invitations.filter((i) => i.accepted_at === null && new Date(i.expires_at) > new Date())

  const enriched = useMemo(() => users.map((u) => {
    const sub = u.subcontractor_id ? subMap.get(u.subcontractor_id) ?? null : null
    return {
      ...u,
      username: displayUsername(u, sub),
      company: displayCompany(u, sub),
    }
  }), [users, subMap])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return enriched
    return enriched.filter((u) =>
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
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
        if (sortKey === 'username') return x.username
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
    const headers = ['Navn', 'Brukernavn', 'E-post', 'Brukernivå', 'BrukerId', 'Status', 'Selskap']
    const rows = sorted.map((u) => [
      u.full_name, u.username, u.email, roleLabel(u.role), u.id,
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
            {inviteError && <div className="sm:col-span-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{inviteError}</div>}
            {inviteSuccess && <div className="sm:col-span-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{inviteSuccess}</div>}
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
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-gray-200 text-[var(--color-text-primary)] rounded-lg font-medium"
          >
            <Download size={13} /> Eksporter CSV
          </button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Laster...</div>
        ) : (
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
                  <Th label="Brukernavn" sortKey="username" current={sortKey} dir={sortDir} onSort={toggleSort} />
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
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-[var(--color-text-primary)]">{u.full_name}</td>
                    <td className="px-3 py-2.5 text-[var(--color-text-secondary)] font-mono text-xs">{u.username}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        u.role === 'main' || u.role === 'project_manager' || u.role === 'company'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}>
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--color-text-muted)] font-mono text-xs">{u.id.slice(0, 8)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        u.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {u.active ? 'Aktiv' : 'Av'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">{u.company}</td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-sm text-[var(--color-text-muted)]">
                      {search ? 'Ingen treff' : 'Ingen brukere'}
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
