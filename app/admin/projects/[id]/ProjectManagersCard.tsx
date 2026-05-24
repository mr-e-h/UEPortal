'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'

interface PMRow {
  id: string
  project_id: string
  user_id: string
  assigned_at: string
  user: { id: string; full_name: string; email: string } | null
}

interface UserOption {
  id: string
  full_name: string
  email: string
}

/**
 * Mini-section i OverviewSection for å tildele PMs til prosjektet.
 * Bare brukere med rolle `project_manager` kan tildeles; main/company ser
 * uansett alle prosjekter, så de er ikke i drop-downen.
 */
export default function ProjectManagersCard({ projectId }: { projectId: string }) {
  const [pms, setPms] = useState<PMRow[]>([])
  const [eligibleUsers, setEligibleUsers] = useState<UserOption[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const [pmRes, usersRes] = await Promise.all([
        fetch(`/api/project-managers?project_id=${projectId}`),
        fetch('/api/users'),
      ])
      const pmData = pmRes.ok ? await pmRes.json() : []
      const usersData = usersRes.ok ? await usersRes.json() : []
      setPms(Array.isArray(pmData) ? pmData : [])
      const all = Array.isArray(usersData) ? usersData as UserOption[] & { role: string }[] : []
      setEligibleUsers(all.filter((u) => (u as unknown as { role: string }).role === 'project_manager'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [projectId])

  async function assign() {
    if (!selectedUserId) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/project-managers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, user_id: selectedUserId }),
    })
    setBusy(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }))
      setError(d.error ?? 'Tildeling feilet')
      return
    }
    setSelectedUserId('')
    await load()
  }

  async function remove(id: string) {
    setBusy(true)
    await fetch(`/api/project-managers?id=${id}`, { method: 'DELETE' })
    setBusy(false)
    await load()
  }

  const assignedIds = new Set(pms.map((p) => p.user_id))
  const availableUsers = eligibleUsers.filter((u) => !assignedIds.has(u.id))

  return (
    <Card className="p-5 space-y-3">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Prosjektledere</h3>
      <p className="text-xs text-[var(--color-text-muted)]">
        PMs som ser dette prosjektet. main/company ser alle uansett.
      </p>

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Laster...</p>
      ) : (
        <>
          {pms.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Ingen tildelt</p>
          ) : (
            <ul className="space-y-1.5">
              {pms.map((pm) => (
                <li key={pm.id} className="flex justify-between items-center text-sm py-1 border-b border-border last:border-0">
                  <div>
                    <span className="font-medium text-[var(--color-text-primary)]">
                      {pm.user?.full_name ?? '(ukjent bruker)'}
                    </span>
                    {pm.user && <span className="text-xs text-[var(--color-text-muted)] ml-2">{pm.user.email}</span>}
                  </div>
                  <button
                    onClick={() => remove(pm.id)}
                    disabled={busy}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                  >
                    Fjern
                  </button>
                </li>
              ))}
            </ul>
          )}

          {availableUsers.length > 0 && (
            <div className="flex gap-2 items-center pt-1">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm border border-border rounded bg-card text-[var(--color-text-primary)]"
              >
                <option value="">Velg PM å legge til</option>
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name} — {u.email}</option>
                ))}
              </select>
              <Button variant="primary" className="px-3 py-1.5 text-xs" disabled={!selectedUserId || busy} onClick={assign}>
                Legg til
              </Button>
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </>
      )}
    </Card>
  )
}
