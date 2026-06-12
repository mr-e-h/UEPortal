'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'

interface SMRow {
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
 * Mini-section i OverviewSection for å tildele byggeledere til prosjektet.
 * Speiler ProjectManagersCard. Bare brukere med rolle `byggeleder` kan
 * tildeles; tildelingen styrer hvilke prosjekter byggelederen ser
 * (lib/api-guard.getProjectScope leser project_site_managers). Skrive-API-et
 * er requireUserAdmin (main/company) — for andre roller viser kortet kun
 * listen, og handlinger avvises server-side.
 */
export default function SiteManagersCard({ projectId }: { projectId: string }) {
  const [sms, setSms] = useState<SMRow[]>([])
  const [eligibleUsers, setEligibleUsers] = useState<UserOption[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const [smRes, usersRes] = await Promise.all([
        fetch(`/api/project-site-managers?project_id=${projectId}`),
        fetch('/api/users'),
      ])
      const smData = smRes.ok ? await smRes.json() : []
      const usersData = usersRes.ok ? await usersRes.json() : []
      setSms(Array.isArray(smData) ? smData : [])
      const all = Array.isArray(usersData) ? usersData as (UserOption & { role: string })[] : []
      setEligibleUsers(all.filter((u) => u.role === 'byggeleder'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function assign() {
    if (!selectedUserId) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/project-site-managers', {
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
    await fetch(`/api/project-site-managers?id=${id}`, { method: 'DELETE' })
    setBusy(false)
    await load()
  }

  const assignedIds = new Set(sms.map((s) => s.user_id))
  const availableUsers = eligibleUsers.filter((u) => !assignedIds.has(u.id))

  return (
    <Card className="p-4 space-y-2">
      <h3
        className="text-sm font-semibold text-[var(--color-text-primary)]"
        title="Byggeledere som følger opp prosjektet. De ser kun tildelte prosjekter, uten kundepris/økonomi."
      >
        Byggeledere
      </h3>

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Laster...</p>
      ) : (
        <>
          {sms.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Ingen tildelt</p>
          ) : (
            <ul className="space-y-1.5">
              {sms.map((sm) => (
                <li key={sm.id} className="flex justify-between items-center text-sm py-1 border-b border-border last:border-0">
                  <div>
                    <span className="font-medium text-[var(--color-text-primary)]">
                      {sm.user?.full_name ?? '(ukjent bruker)'}
                    </span>
                    {sm.user && <span className="text-xs text-[var(--color-text-muted)] ml-2">{sm.user.email}</span>}
                  </div>
                  <button
                    onClick={() => remove(sm.id)}
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
                <option value="">Velg byggeleder å legge til</option>
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
