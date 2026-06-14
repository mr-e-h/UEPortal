'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import Card from '@/components/ui/Card'
import { fmtNumber, parseNorwegianNumber } from '@/lib/format'
import type { ProjectSubcontractor, Subcontractor } from '@/types'

interface AssignRow {
  id: string
  user_id: string
  user: { id: string; full_name: string; email: string } | null
}
interface UserOption { id: string; full_name: string; email: string; role?: string }

interface Props {
  projectId: string
  projectSubs: ProjectSubcontractor[]
  allSubs: Subcontractor[]
  /** Manuell overstyring av tiltenkte timer (null = bruk beregnet). */
  plannedHoursOverride: number | null
  /** Legg til UE — tar id-en direkte (ett-klikks). Bruker forelderens handler. */
  onAddSub: (subId: string) => Promise<void> | void
  /** Fjern UE — går via forelderens bekreftelsesdialog. */
  onRequestRemoveSub: (linkId: string) => void
  /** Re-hent etter at overstyringen av timer er lagret. */
  onProjectUpdated: () => void
}

/** Liten «pille» med navn + fjern-kryss. */
function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 bg-muted text-[var(--color-text-secondary)] rounded-full pl-2.5 pr-1 py-0.5 text-xs">
      <span className="font-medium text-[var(--color-text-primary)] truncate max-w-[160px]">{label}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="p-0.5 rounded-full text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50" aria-label={`Fjern ${label}`}>
          <X size={12} />
        </button>
      )}
    </span>
  )
}

/** Én rad: etikett til venstre, chips + «legg til»-velger til høyre. */
function SetupRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 py-3 first:pt-0 last:pb-0">
      <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide w-full sm:w-36 flex-none">{label}</span>
      <div className="flex-1 flex items-center gap-2 flex-wrap min-h-[28px]">{children}</div>
    </div>
  )
}

const addSelectCls = 'text-xs text-[var(--color-text-secondary)] border border-border rounded-full px-2 py-1 bg-card hover:bg-muted focus:outline-none focus:border-primary'

/**
 * Samlet «Oppsett»-kort øverst i Oversikt: prosjektledere, byggeledere,
 * underentreprenører og timer tiltenkt — alt på ett sted med chips og
 * ett-klikks innlegging. Den detaljerte UE-kostnadsflyten ligger lenger ned.
 *
 * PL/byggeleder hentes og endres her direkte (samme API som de gamle kortene);
 * UE bruker forelderens data + handlere; timer lagres via PUT /api/projects/[id].
 */
export default function ProjectSetupCard({
  projectId, projectSubs, allSubs, plannedHoursOverride, onAddSub, onRequestRemoveSub, onProjectUpdated,
}: Props) {
  const [pms, setPms] = useState<AssignRow[]>([])
  const [sms, setSms] = useState<AssignRow[]>([])
  const [eligiblePMs, setEligiblePMs] = useState<UserOption[]>([])
  const [eligibleBLs, setEligibleBLs] = useState<UserOption[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Beregnede tiltenkte timer (ordreverdi-vektet andel av poolen over varigheten).
  const [allocatedHours, setAllocatedHours] = useState<number | null>(null)
  // Timer-feltet viser effektiv verdi: overstyring hvis satt, ellers beregnet.
  // Draften seedes når enten overstyringen eller det beregnede tallet endres.
  const [hoursDraft, setHoursDraft] = useState('')
  const [savingHours, setSavingHours] = useState(false)
  useEffect(() => {
    const eff = plannedHoursOverride ?? allocatedHours
    setHoursDraft(eff != null ? String(eff) : '')
  }, [plannedHoursOverride, allocatedHours])

  async function load() {
    const [pmRes, smRes, usersRes, ahRes] = await Promise.all([
      fetch(`/api/project-managers?project_id=${projectId}`),
      fetch(`/api/project-site-managers?project_id=${projectId}`),
      fetch('/api/users'),
      fetch(`/api/projects/${projectId}/allocated-hours`),
    ])
    const pmData = pmRes.ok ? await pmRes.json() : []
    const smData = smRes.ok ? await smRes.json() : []
    const usersData = usersRes.ok ? await usersRes.json() : []
    const ahData = ahRes.ok ? await ahRes.json() as { hours: number | null } : { hours: null }
    setPms(Array.isArray(pmData) ? pmData : [])
    setSms(Array.isArray(smData) ? smData : [])
    const all = Array.isArray(usersData) ? usersData as UserOption[] : []
    setEligiblePMs(all.filter((u) => u.role === 'project_manager'))
    setEligibleBLs(all.filter((u) => u.role === 'byggeleder'))
    setAllocatedHours(ahData.hours)
  }
  useEffect(() => { load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function assign(url: string, userId: string) {
    setBusy(true); setError(null)
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, user_id: userId }),
    })
    setBusy(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }))
      setError(d.error ?? 'Tildeling feilet'); return
    }
    await load()
  }
  async function unassign(url: string) {
    setBusy(true); setError(null)
    await fetch(url, { method: 'DELETE' })
    setBusy(false)
    await load()
  }

  async function putPlannedHours(value: number | null) {
    setSavingHours(true); setError(null)
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planned_hours: value }),
    })
    setSavingHours(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }))
      setError(d.error ?? 'Lagring feilet'); return
    }
    onProjectUpdated()
  }
  function saveOverride() {
    const raw = hoursDraft.trim()
    const parsed = raw === '' ? null : parseNorwegianNumber(raw)
    // Tom, eller lik det beregnede tallet => ingen overstyring (bruk beregnet).
    const next = parsed == null || (allocatedHours != null && parsed === allocatedHours) ? null : parsed
    if ((plannedHoursOverride ?? null) === (next ?? null)) return
    putPlannedHours(next)
  }
  function resetOverride() {
    if (plannedHoursOverride == null) return
    putPlannedHours(null)
  }

  const pmIds = new Set(pms.map((p) => p.user_id))
  const blIds = new Set(sms.map((s) => s.user_id))
  const availablePMs = eligiblePMs.filter((u) => !pmIds.has(u.id))
  const availableBLs = eligibleBLs.filter((u) => !blIds.has(u.id))

  const assignedSubIds = new Set(projectSubs.map((ps) => ps.subcontractor_id))
  const ueChips = allSubs
    .filter((s) => assignedSubIds.has(s.id))
    .map((s) => ({ sub: s, linkId: projectSubs.find((ps) => ps.subcontractor_id === s.id)?.id ?? null }))
  const availableSubs = allSubs.filter((s) => s.active && !assignedSubIds.has(s.id))

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">Oppsett</h2>
      <div className="divide-y divide-border">
        {/* Prosjektledere */}
        <SetupRow label="Prosjektledere">
          {pms.length === 0 && availablePMs.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">Ingen tilgjengelige</span>}
          {pms.map((pm) => (
            <Chip key={pm.id} label={pm.user?.full_name ?? '(ukjent)'} onRemove={busy ? undefined : () => unassign(`/api/project-managers?id=${pm.id}`)} />
          ))}
          {availablePMs.length > 0 && (
            <select value="" disabled={busy} onChange={(e) => { if (e.target.value) assign('/api/project-managers', e.target.value) }} className={addSelectCls} aria-label="Legg til prosjektleder">
              <option value="">+ Legg til</option>
              {availablePMs.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          )}
        </SetupRow>

        {/* Byggeledere */}
        <SetupRow label="Byggeledere">
          {sms.length === 0 && availableBLs.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">Ingen tilgjengelige</span>}
          {sms.map((sm) => (
            <Chip key={sm.id} label={sm.user?.full_name ?? '(ukjent)'} onRemove={busy ? undefined : () => unassign(`/api/project-site-managers?id=${sm.id}`)} />
          ))}
          {availableBLs.length > 0 && (
            <select value="" disabled={busy} onChange={(e) => { if (e.target.value) assign('/api/project-site-managers', e.target.value) }} className={addSelectCls} aria-label="Legg til byggeleder">
              <option value="">+ Legg til</option>
              {availableBLs.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          )}
        </SetupRow>

        {/* Underentreprenører */}
        <SetupRow label="Underentreprenører">
          {ueChips.length === 0 && availableSubs.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">Ingen tilgjengelige</span>}
          {ueChips.map(({ sub, linkId }) => (
            <Chip key={sub.id} label={sub.company_name} onRemove={linkId ? () => onRequestRemoveSub(linkId) : undefined} />
          ))}
          {availableSubs.length > 0 && (
            <select value="" disabled={busy} onChange={(e) => { if (e.target.value) onAddSub(e.target.value) }} className={addSelectCls} aria-label="Legg til underentreprenør">
              <option value="">+ Legg til</option>
              {availableSubs.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
            </select>
          )}
        </SetupRow>

        {/* Timer tiltenkt — utgangspunkt er det beregnede tallet (ordreverdi-
            vektet andel av poolen over varigheten); kan dras opp/ned manuelt.
            Tom/lik beregnet = ingen overstyring. */}
        <SetupRow label="Timer tiltenkt">
          <input
            value={hoursDraft}
            inputMode="decimal"
            onChange={(e) => setHoursDraft(e.target.value)}
            onBlur={saveOverride}
            disabled={savingHours}
            placeholder="0"
            className="w-24 text-right text-sm border border-border rounded px-2 py-1 bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary disabled:opacity-50"
            aria-label="Timer tiltenkt på prosjektet"
          />
          <span className="text-xs text-[var(--color-text-muted)]">t</span>
          {plannedHoursOverride != null ? (
            <span className="text-xs text-[var(--color-text-muted)]">
              justert{allocatedHours != null && <> fra {fmtNumber(allocatedHours, 0)} t beregnet</>} ·{' '}
              <button type="button" onClick={resetOverride} disabled={savingHours} className="text-primary hover:underline disabled:opacity-50">Tilbakestill</button>
            </span>
          ) : (
            <span className="text-xs text-[var(--color-text-muted)]">
              {allocatedHours != null ? 'beregnet fra ordreverdi og kapasitet — juster ved behov' : 'beregnes for aktive prosjekter med datoer'}
            </span>
          )}
        </SetupRow>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </Card>
  )
}
