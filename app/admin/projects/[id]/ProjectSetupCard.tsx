'use client'

import { useEffect, useState } from 'react'
import { X, User, HardHat, Users, Building2, Clock } from 'lucide-react'
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

/** Slank pille med navn + fjern-kryss (lett, hårfin ramme). */
function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card pl-2.5 pr-1 py-0.5 text-xs">
      <span className="font-medium text-[var(--color-text-primary)] truncate max-w-[150px]">{label}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="grid place-items-center w-4 h-4 rounded-full text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50" aria-label={`Fjern ${label}`}>
          <X size={11} />
        </button>
      )}
    </span>
  )
}

/** Én rad: ikon + etikett til venstre, kontroll til høyre. Slank vertikal rytme. */
function SetupRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="flex items-center gap-2 w-40 flex-none text-xs font-medium text-[var(--color-text-secondary)]">
        <span className="text-[var(--color-text-muted)] flex-none">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <div className="flex-1 flex items-center gap-1.5 flex-wrap min-h-[34px]">{children}</div>
    </div>
  )
}

/**
 * Slankt nedtrekk for én-person-rollene (PL/byggeleder): viser den valgte
 * personen direkte. Tom = «Velg …» når ingen er satt, «Ingen» (fjern) når satt.
 * Ett kontroll-element i stedet for chip + egen bytt-velger.
 */
function SinglePicker({ value, options, placeholder, disabled, onChange }: {
  value: string
  options: UserOption[]
  placeholder: string
  disabled: boolean
  onChange: (userId: string) => void
}) {
  if (options.length === 0 && !value) {
    return <span className="text-xs text-[var(--color-text-muted)]">Ingen tilgjengelige</span>
  }
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder}
      className="max-w-[230px] text-sm text-[var(--color-text-primary)] border border-border rounded-lg pl-2.5 pr-7 py-1.5 bg-card focus:outline-none focus:border-primary disabled:opacity-50"
    >
      <option value="">{value ? 'Ingen' : placeholder}</option>
      {options.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
    </select>
  )
}

/** Stripet «+ Legg til»-nedtrekk for fler-rollene (deltakere/UE). */
const addSelectCls = 'text-xs font-medium text-primary border border-dashed border-border rounded-full pl-2.5 pr-6 py-1 bg-card hover:bg-primary-soft hover:border-primary focus:outline-none focus:border-primary cursor-pointer disabled:opacity-50'

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
  const [participants, setParticipants] = useState<AssignRow[]>([])
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
    const [pmRes, smRes, partRes, usersRes, ahRes] = await Promise.all([
      fetch(`/api/project-managers?project_id=${projectId}`),
      fetch(`/api/project-site-managers?project_id=${projectId}`),
      fetch(`/api/project-participants?project_id=${projectId}`),
      fetch('/api/users'),
      fetch(`/api/projects/${projectId}/allocated-hours`),
    ])
    const pmData = pmRes.ok ? await pmRes.json() : []
    const smData = smRes.ok ? await smRes.json() : []
    const partData = partRes.ok ? await partRes.json() : []
    const usersData = usersRes.ok ? await usersRes.json() : []
    const ahData = ahRes.ok ? await ahRes.json() as { hours: number | null } : { hours: null }
    setPms(Array.isArray(pmData) ? pmData : [])
    setSms(Array.isArray(smData) ? smData : [])
    setParticipants(Array.isArray(partData) ? partData : [])
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

  // Nøyaktig én PL + én byggeleder. Deltakere er øvrige interne (PL/byggeleder)
  // med innsyn — ikke den som allerede er ansvarlig, og ikke dobbelt opp.
  const pl = pms[0] ?? null
  const bl = sms[0] ?? null
  const participantUserIds = new Set(participants.map((p) => p.user_id))
  const participantOptions = [...eligiblePMs, ...eligibleBLs].filter(
    (u) => u.id !== pl?.user_id && u.id !== bl?.user_id && !participantUserIds.has(u.id),
  )

  const assignedSubIds = new Set(projectSubs.map((ps) => ps.subcontractor_id))
  const ueChips = allSubs
    .filter((s) => assignedSubIds.has(s.id))
    .map((s) => ({ sub: s, linkId: projectSubs.find((ps) => ps.subcontractor_id === s.id)?.id ?? null }))
  const availableSubs = allSubs.filter((s) => s.active && !assignedSubIds.has(s.id))

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">Oppsett</h2>
      <div className="divide-y divide-border">
        {/* Prosjektleder — nøyaktig én, byttbar via ett slankt nedtrekk */}
        <SetupRow icon={<User size={14} />} label="Prosjektleder">
          <SinglePicker
            value={pl?.user_id ?? ''}
            options={eligiblePMs}
            placeholder="Velg prosjektleder"
            disabled={busy}
            onChange={(uid) => {
              if (!uid && pl) unassign(`/api/project-managers?id=${pl.id}`)
              else if (uid && uid !== pl?.user_id) assign('/api/project-managers', uid)
            }}
          />
        </SetupRow>

        {/* Byggeleder — nøyaktig én, byttbar */}
        <SetupRow icon={<HardHat size={14} />} label="Byggeleder">
          <SinglePicker
            value={bl?.user_id ?? ''}
            options={eligibleBLs}
            placeholder="Velg byggeleder"
            disabled={busy}
            onChange={(uid) => {
              if (!uid && bl) unassign(`/api/project-site-managers?id=${bl.id}`)
              else if (uid && uid !== bl?.user_id) assign('/api/project-site-managers', uid)
            }}
          />
        </SetupRow>

        {/* Deltakere — øvrige interne (PL/byggeledere) med innsyn i prosjektet */}
        <SetupRow icon={<Users size={14} />} label="Deltakere">
          {participants.map((p) => (
            <Chip key={p.id} label={p.user?.full_name ?? '(ukjent)'} onRemove={busy ? undefined : () => unassign(`/api/project-participants?id=${p.id}`)} />
          ))}
          {participantOptions.length > 0 ? (
            <select value="" disabled={busy} onChange={(e) => { if (e.target.value) assign('/api/project-participants', e.target.value) }} className={addSelectCls} aria-label="Legg til deltaker">
              <option value="">+ Legg til</option>
              {participantOptions.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          ) : participants.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">Ingen tilgjengelige</span>}
        </SetupRow>

        {/* Underentreprenører */}
        <SetupRow icon={<Building2 size={14} />} label="Underentreprenører">
          {ueChips.map(({ sub, linkId }) => (
            <Chip key={sub.id} label={sub.company_name} onRemove={linkId ? () => onRequestRemoveSub(linkId) : undefined} />
          ))}
          {availableSubs.length > 0 ? (
            <select value="" disabled={busy} onChange={(e) => { if (e.target.value) onAddSub(e.target.value) }} className={addSelectCls} aria-label="Legg til underentreprenør">
              <option value="">+ Legg til</option>
              {availableSubs.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
            </select>
          ) : ueChips.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">Ingen tilgjengelige</span>}
        </SetupRow>

        {/* Timer tiltenkt — utgangspunkt er det beregnede tallet (ordreverdi-
            vektet andel av poolen over varigheten); kan dras opp/ned manuelt.
            Tom/lik beregnet = ingen overstyring. */}
        <SetupRow icon={<Clock size={14} />} label="Timer tiltenkt">
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
