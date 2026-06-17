'use client'

import { useEffect, useState } from 'react'
import { Plus, X, Pencil, Trash2, Check, Undo2 } from 'lucide-react'
import { useMe } from '@/lib/useMe'
import { fmtDateShort as fmtD } from '@/lib/format'
import { ADMIN_ROLES } from '@/lib/roles'
import {
  DAY, FALLBACK_COLOR, STATUS_LABEL, barSpanMs, pctPos, useTimelineDrag,
  type TimelineItem, type ItemDraft, type PhaseStatus,
} from '@/components/fremdriftsplan/core'
import TimelineBar from '@/components/fremdriftsplan/TimelineBar'
import { api, apiErrorMessage } from '@/lib/api'
import type { GanttMilestone, PhaseType, ProjectPhase } from '@/types'

/**
 * Fremdriftsplanen for et prosjekt — tidslinjen ER editoren, med eksplisitt
 * redigeringsmodus og utkast-lagring:
 *
 *   Visning:   ren tidslinje + «Rediger fremdriftsplan»-knapp. Ingen
 *              mutasjon mulig.
 *   Redigering: dra ender (forleng/forkort), dra midten (flytt), blyant
 *              (type/navn/datoer/status/fremdrift), slett (med angre),
 *              legg til fase / standardfaser. ALT samles som utkast og
 *              skrives først når man trykker «Lagre» — «Avbryt» forkaster.
 *              (Unntak: «Legg til fase»/«Legg til standardfaser» oppretter
 *              med en gang — de er additive; utkastene dine beholdes.)
 *
 * Datakilder: project_phases (eget API-kall) + milestones (props) — samme
 * to kilder som alle andre fremdriftsvisninger. Roller: admin-rollene
 * redigerer alt; byggeleder kun fase-status/fremdrift (API-håndhevet).
 */

type Phase = ProjectPhase

/** Panelets rad = kjernens element + visningsfelter. */
type Row = TimelineItem & {
  pctLabel: string
  phase?: Phase
  milestone?: GanttMilestone
}

type RowDraft = ItemDraft

type EditDraft = {
  phase_type_id: string
  name: string
  start: string
  end: string
  status: PhaseStatus
  progress: string
  subcontractor_id: string
}

/**
 * Månedsgrensene (i ms) som ligger strengt INNE i [min, max]. Brukes til å
 * tegne et svakt måneds-rutenett bortover bak barene, så det er lettere å se
 * hvor månedene (og dermed hvor ting starter) ligger. UTC for å matche
 * Date.parse av ISO-datoene barene bruker.
 */
function monthStartsBetween(min: number, max: number): number[] {
  if (!(max > min)) return []
  const out: number[] = []
  const d = new Date(min)
  let y = d.getUTCFullYear()
  let m = d.getUTCMonth()
  let cur = Date.UTC(y, m, 1)
  while (cur <= max && out.length < 240) {
    if (cur > min) out.push(cur)
    m++
    if (m > 11) { m = 0; y++ }
    cur = Date.UTC(y, m, 1)
  }
  return out
}

const MONTHS_ABBR = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']

/**
 * Synlige måneds-segmenter i [min, max] med midtpunkt (ms) for å plassere en
 * måneds-etikett midt i hver måned. Året vises på første måned og hver januar
 * så aksen er lett å lese uten å gjenta året overalt.
 */
function monthSegments(min: number, max: number): { mid: number; label: string }[] {
  if (!(max > min)) return []
  const out: { mid: number; label: string }[] = []
  const d = new Date(min)
  let y = d.getUTCFullYear()
  let m = d.getUTCMonth()
  let segStart = Date.UTC(y, m, 1)
  let first = true
  while (segStart < max && out.length < 240) {
    const next = Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, 1)
    const visStart = Math.max(segStart, min)
    const visEnd = Math.min(next, max)
    if (visEnd > visStart) {
      const showYear = first || m === 0
      out.push({ mid: (visStart + visEnd) / 2, label: showYear ? `${MONTHS_ABBR[m]} ${String(y).slice(2)}` : MONTHS_ABBR[m] })
      first = false
    }
    m++
    if (m > 11) { m = 0; y++ }
    segStart = next
  }
  return out
}

export default function PhasesMiniStrip({
  projectId,
  projectStart,
  projectEnd,
  milestones,
  onOpenFremdriftsplan,
  onMilestonesChanged,
  manage = false,
}: {
  projectId: string
  projectStart: string | null
  projectEnd: string | null
  milestones: GanttMilestone[]
  /** Uten callback (på selve Fremdriftsplan-fanen) skjules snarvei-knappen. */
  onOpenFremdriftsplan?: () => void
  /** Kalles etter at milepæl-endringer er lagret (forelderen eier staten). */
  onMilestonesChanged?: () => Promise<void> | void
  /** true på Fremdriftsplan-fanen: viser «Rediger fremdriftsplan». */
  manage?: boolean
}) {
  const { me } = useMe()
  const canManage = !!me && ADMIN_ROLES.includes(me.role)
  const canTouchStatus = canManage || me?.role === 'byggeleder'

  const [phases, setPhases] = useState<Phase[]>([])
  const [types, setTypes] = useState<PhaseType[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // Ansvar-tabellen: hvilken fase lagrer akkurat nå (deaktiverer dens nedtrekk).
  const [assigningId, setAssigningId] = useState<string | null>(null)
  // Vekt-kolonnen: hvilken fase lagrer vekt akkurat nå.
  const [weightSavingId, setWeightSavingId] = useState<string | null>(null)

  // UE-er tildelt dette prosjektet: id → company_name
  const [projectUes, setProjectUes] = useState<{ id: string; company_name: string }[]>([])

  // Redigeringsmodus + utkast.
  const [editMode, setEditMode] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const [deleted, setDeleted] = useState<Set<string>>(new Set())

  // Legg til fase (instant — additiv).
  const [showAdd, setShowAdd] = useState(false)
  const emptyDraft = (typeId = ''): EditDraft => ({
    phase_type_id: typeId, name: '', start: projectStart ?? '', end: projectEnd ?? '', status: 'planned', progress: '0', subcontractor_id: '',
  })
  const [addDraft, setAddDraft] = useState<EditDraft>(emptyDraft())

  // Blyant (inline-skjema) — skriver til utkastet, ikke API.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft>(emptyDraft())

  // Dra-tilstand: forhåndsvisning under draing + kjernens dra-mekanikk.
  const [override, setOverride] = useState<Record<string, { start: string; end: string | null }>>({})
  const { dragTip, dragging, startDrag } = useTimelineDrag({
    enabled: canManage && editMode,
    onPreview: (id, s, e) => setOverride((prev) => ({ ...prev, [id]: { start: s, end: e } })),
    onClearPreview: (id) => setOverride((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    }),
    onCommit: (item, s, e) => setDrafts((prev) => ({
      ...prev,
      [item.id]: { ...prev[item.id], start: s, end: e },
    })),
  })

  async function fetchPhases() {
    const [p, t] = await Promise.all([
      api.projectPhases.list(projectId).catch(() => []),
      api.phaseTypes.list().catch(() => []),
    ])
    setPhases(Array.isArray(p) ? p : [])
    setTypes(Array.isArray(t) ? t : [])
  }

  // Auto-arkiver et øyeblikksbilde av planen etter en lagring. Fire-and-forget
  // (feiler stille — historikken er sekundær til selve lagringen). Server-siden
  // hopper over hvis planen er uendret, så ingen tomme logglinjer.
  function snapshotVersion() {
    api.projectPhaseVersions.snapshot(projectId).catch(() => {})
  }

  useEffect(() => {
    let cancelled = false

    async function loadAll() {
      await fetchPhases()
      // Last prosjektets UE-er: koble project_subcontractors med subcontractors
      try {
        const [links, subs] = await Promise.all([
          fetch(`/api/project-subcontractors?project_id=${encodeURIComponent(projectId)}`, { credentials: 'same-origin' }).then((r) => r.ok ? r.json() : []),
          fetch('/api/subcontractors', { credentials: 'same-origin' }).then((r) => r.ok ? r.json() : []),
        ])
        if (!cancelled) {
          const subMap = new Map<string, string>(
            (subs as { id: string; company_name: string }[]).map((s) => [s.id, s.company_name])
          )
          const ues = (links as { subcontractor_id: string }[])
            .map((l) => ({ id: l.subcontractor_id, company_name: subMap.get(l.subcontractor_id) ?? l.subcontractor_id }))
            .filter((u) => u.id)
          setProjectUes(ues)
        }
      } catch {
        // UE-liste er ikke kritisk — fremdriftsplanen fungerer uten
      }
    }

    loadAll().then(() => { if (!cancelled) setLoaded(true) }).catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  if (!loaded) return null

  const typeMap = new Map(types.map((t) => [t.id, t]))
  const ueMap = new Map(projectUes.map((u) => [u.id, u.company_name]))

  const baseRows: Row[] = [
    ...phases.map((p) => {
      const t = typeMap.get(p.phase_type_id)
      return {
        id: `phase-${p.id}`,
        kind: 'phase' as const,
        rawId: p.id,
        label: p.name || t?.name || 'Fase',
        color: t?.color || FALLBACK_COLOR,
        start: p.start_date,
        end: p.end_date,
        done: p.status === 'done',
        pctLabel: p.status === 'done' ? '✓' : p.progress_percent > 0 ? `${p.progress_percent}%` : '',
        phase: p,
      }
    }),
    ...milestones.map((m) => ({
      id: `ms-${m.id}`,
      kind: 'milestone' as const,
      rawId: m.id,
      label: m.title,
      color: m.color || FALLBACK_COLOR,
      start: m.start_date,
      end: m.end_date as string | null,
      done: false,
      pctLabel: '',
      milestone: m,
    })),
  ]

  // Utkast + dra-overrides oppå basisradene.
  const applyDraft = (r: Row): Row => {
    const d = drafts[r.id]
    const o = override[r.id]
    if (!d && !o) return r
    const t = d?.phase_type_id ? typeMap.get(d.phase_type_id) : undefined
    const status = d?.status ?? r.phase?.status
    const progress = d?.progress ?? r.phase?.progress_percent ?? 0
    return {
      ...r,
      label: d?.name !== undefined
        ? (d.name || t?.name || typeMap.get(r.phase?.phase_type_id ?? '')?.name || r.label)
        : (t ? (r.phase?.name || t.name) : r.label),
      color: t?.color ?? r.color,
      start: o?.start ?? d?.start ?? r.start,
      end: o !== undefined ? o.end : (d?.end !== undefined ? d.end : r.end),
      done: r.kind === 'phase' ? status === 'done' : false,
      pctLabel: r.kind === 'phase'
        ? (status === 'done' ? '✓' : (progress ?? 0) > 0 ? `${progress}%` : '')
        : '',
    }
  }

  // Tidsspenn fryses mot basisverdiene — skalaen flytter seg ikke under
  // hånden mens man drar/utkaster.
  const dates: number[] = []
  if (projectStart) dates.push(Date.parse(projectStart))
  if (projectEnd) dates.push(Date.parse(projectEnd))
  for (const r of baseRows) {
    dates.push(Date.parse(r.start))
    if (r.end) dates.push(Date.parse(r.end))
  }
  const hasSpan = dates.length > 0
  const min = hasSpan ? Math.min(...dates) : 0
  const max = hasSpan ? Math.max(Math.max(...dates), min + 30 * DAY) : 1
  const span = max - min
  const monthLines = monthStartsBetween(min, max)
  const monthSegs = monthSegments(min, max)

  const rows = baseRows
    .map(applyDraft)
    .sort((a, b) => a.start.localeCompare(b.start))

  const changeCount = new Set([...Object.keys(drafts), ...Array.from(deleted)]).size

  // Barposisjon i % — punkt-semantikk og dag-matte fra kjernen.
  const pos = (startISO: string, endISO: string | null) => {
    const { s, e } = barSpanMs(startISO, endISO)
    return {
      left: `${pctPos(s, min, max)}%`,
      width: `${Math.max(1.5, ((Math.max(e, s + DAY) - s) / span) * 100)}%`,
    }
  }

  const today = Date.now()
  const todayPct = today >= min && today <= max ? ((today - min) / span) * 100 : null

  // ── Blyant → utkast ─────────────────────────────────────────────────
  function startEdit(row: Row) {
    setEditingId(row.id)
    setError('')
    const d = drafts[row.id]
    if (row.kind === 'phase' && row.phase) {
      setEditDraft({
        phase_type_id: d?.phase_type_id ?? row.phase.phase_type_id,
        name: d?.name ?? row.phase.name ?? '',
        start: d?.start ?? row.phase.start_date,
        end: (d?.end !== undefined ? d.end : row.phase.end_date) ?? '',
        status: d?.status ?? row.phase.status,
        progress: String(d?.progress ?? row.phase.progress_percent),
        subcontractor_id: d?.subcontractor_id !== undefined ? (d.subcontractor_id ?? '') : (row.phase.subcontractor_id ?? ''),
      })
    } else if (row.milestone) {
      setEditDraft({
        phase_type_id: '',
        name: d?.name ?? row.milestone.title,
        start: d?.start ?? row.milestone.start_date,
        end: (d?.end !== undefined ? d.end : row.milestone.end_date) ?? '',
        status: 'planned', progress: '0', subcontractor_id: '',
      })
    }
  }

  function applyEditToDraft(row: Row) {
    setDrafts((prev) => ({
      ...prev,
      [row.id]: row.kind === 'phase'
        ? (canManage
          ? {
              ...prev[row.id],
              phase_type_id: editDraft.phase_type_id,
              name: editDraft.name,
              start: editDraft.start,
              end: editDraft.end || null,
              status: editDraft.status,
              progress: Number(editDraft.progress) || 0,
            }
          : { ...prev[row.id], status: editDraft.status, progress: Number(editDraft.progress) || 0 })
        : { ...prev[row.id], name: editDraft.name, start: editDraft.start, end: editDraft.end || editDraft.start },
    }))
    setEditingId(null)
  }

  // ── Lagre alt / avbryt ──────────────────────────────────────────────
  function cancelEdit() {
    setDrafts({})
    setDeleted(new Set())
    setOverride({})
    setEditingId(null)
    setShowAdd(false)
    setError('')
    setEditMode(false)
  }

  async function saveAll() {
    setSaving(true)
    setError('')
    const failures: string[] = []
    let touchedMilestones = false
    const rowById = new Map(baseRows.map((r) => [r.id, r]))

    // Slettinger først.
    for (const id of Array.from(deleted)) {
      const row = rowById.get(id)
      if (!row) continue
      try {
        if (row.kind === 'phase') await api.projectPhases.remove(row.rawId)
        else { await api.milestones.remove(row.rawId); touchedMilestones = true }
      } catch {
        failures.push(`Slett ${row.label}`)
      }
    }

    // Endringer.
    for (const [id, d] of Object.entries(drafts)) {
      if (deleted.has(id)) continue
      const row = rowById.get(id)
      if (!row) continue
      try {
        if (row.kind === 'phase') {
          const body = canManage
            ? {
                ...(d.phase_type_id !== undefined ? { phase_type_id: d.phase_type_id } : {}),
                ...(d.name !== undefined ? { name: d.name || null } : {}),
                ...(d.start !== undefined ? { start_date: d.start } : {}),
                ...(d.end !== undefined ? { end_date: d.end } : {}),
                ...(d.status !== undefined ? { status: d.status } : {}),
                ...(d.progress !== undefined ? { progress_percent: d.progress } : {}),
              }
            : {
                ...(d.status !== undefined ? { status: d.status } : {}),
                ...(d.progress !== undefined ? { progress_percent: d.progress } : {}),
              }
          await api.projectPhases.update(row.rawId, body)
        } else {
          await api.milestones.update({
            id: row.rawId,
            ...(d.name !== undefined ? { title: d.name } : {}),
            ...(d.start !== undefined ? { start_date: d.start } : {}),
            ...(d.end !== undefined ? { end_date: d.end ?? d.start } : {}),
          })
          touchedMilestones = true
        }
      } catch (err) {
        failures.push(`${row.label}: ${apiErrorMessage(err, 'lagring feilet')}`)
      }
    }

    await fetchPhases()
    snapshotVersion()
    if (touchedMilestones) await onMilestonesChanged?.()
    setSaving(false)

    if (failures.length > 0) {
      setError(`Noe feilet: ${failures.join(' · ')}`)
      // Behold utkastene som feilet? Enklest og ærligst: tøm — listen over
      // viser hva som må gjøres på nytt, og basisdata er ferske.
      setDrafts({})
      setDeleted(new Set())
      return
    }
    setDrafts({})
    setDeleted(new Set())
    setEditingId(null)
    setShowAdd(false)
    setEditMode(false)
  }

  // ── Legg til (instant — additiv; utkast beholdes) ───────────────────
  async function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await api.projectPhases.create({
        project_id: projectId,
        phase_type_id: addDraft.phase_type_id,
        name: addDraft.name || null,
        start_date: addDraft.start,
        end_date: addDraft.end || null,
        status: addDraft.status,
        progress_percent: Number(addDraft.progress) || 0,
        subcontractor_id: addDraft.subcontractor_id || null,
      })
    } catch (err) {
      setSaving(false)
      setError(apiErrorMessage(err, 'Lagring feilet'))
      return
    }
    setSaving(false)
    setShowAdd(false)
    setAddDraft(emptyDraft(types[0]?.id))
    await fetchPhases()
    snapshotVersion()
  }

  async function applyStandard() {
    setSaving(true); setError('')
    try {
      await api.projectPhases.applyStandard(projectId)
    } catch (err) {
      setSaving(false)
      setError(apiErrorMessage(err, 'Kunne ikke legge til standardfaser'))
      return
    }
    setSaving(false)
    await fetchPhases()
    snapshotVersion()
  }

  // ── Ansvar-tabell: tildel ansvarlig UE per fase (lagrer med en gang) ──
  async function assignUe(phaseId: string, subId: string) {
    const value = subId || null
    setAssigningId(phaseId)
    setError('')
    // Optimistisk: oppdater lokalt med en gang så nedtrekket føles direkte.
    setPhases((prev) => prev.map((p) => (p.id === phaseId ? { ...p, subcontractor_id: value } : p)))
    try {
      await api.projectPhases.update(phaseId, { subcontractor_id: value })
      snapshotVersion()
    } catch (err) {
      setError(apiErrorMessage(err, 'Kunne ikke lagre ansvarlig'))
      await fetchPhases() // tilbakestill til server-sannhet ved feil
    } finally {
      setAssigningId(null)
    }
  }

  // ── Vekt-kolonne: prognose-vekt per fase (lagrer med en gang) ────────
  async function assignWeight(phaseId: string, weight: number | null) {
    setWeightSavingId(phaseId)
    setError('')
    // Optimistisk: oppdater lokalt med en gang.
    setPhases((prev) => prev.map((p) => (p.id === phaseId ? { ...p, weight } : p)))
    try {
      await api.projectPhases.update(phaseId, { weight })
      snapshotVersion()
    } catch (err) {
      setError(apiErrorMessage(err, 'Kunne ikke lagre vekt'))
      await fetchPhases() // tilbakestill til server-sannhet ved feil
    } finally {
      setWeightSavingId(null)
    }
  }

  const inputCls = 'px-2 py-1 text-xs border border-border rounded bg-card text-[var(--color-text-primary)]'
  const btnSecondary = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card text-[var(--color-text-secondary)] hover:bg-muted disabled:opacity-50'

  return (
    <section className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Fremdriftsplan</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {!editMode ? (
            <>
              {manage && canTouchStatus && (
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-hover"
                >
                  <Pencil size={13} /> Rediger fremdriftsplan
                </button>
              )}
              {onOpenFremdriftsplan && (
                <button
                  type="button"
                  onClick={onOpenFremdriftsplan}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Åpne fremdriftsplan →
                </button>
              )}
            </>
          ) : (
            <>
              {canManage && (
                <span className="text-[10px] text-[var(--color-text-muted)] print:hidden">
                  Dra i endene for å forlenge/forkorte, midten for å flytte
                </span>
              )}
              {canManage && types.length > 0 && (
                <>
                  <button type="button" onClick={applyStandard} disabled={saving} className={btnSecondary}
                    title="Oppretter standardfasene for prosjekttypen (eller alle fasetyper). Typer som allerede har fase hoppes over.">
                    Legg til standardfaser
                  </button>
                  <button type="button" onClick={() => { setAddDraft(emptyDraft(types[0]?.id)); setShowAdd((v) => !v) }} className={btnSecondary}>
                    {showAdd ? <X size={13} /> : <Plus size={13} />} {showAdd ? 'Avbryt ny fase' : 'Legg til fase'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={saveAll}
                disabled={saving || changeCount === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
              >
                <Check size={13} /> {saving ? 'Lagrer…' : changeCount > 0 ? `Lagre (${changeCount})` : 'Lagre'}
              </button>
              <button type="button" onClick={cancelEdit} disabled={saving} className={btnSecondary}>
                <X size={13} /> Avbryt
              </button>
            </>
          )}
        </div>
      </div>

      {manage && editMode && types.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)] bg-warning-soft border border-amber-200 rounded-lg px-3 py-2 mb-3">
          Arbeidsfaser er ikke tilgjengelig ennå.
        </p>
      )}

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {/* Legg til fase */}
      {editMode && showAdd && canManage && (
        <form onSubmit={submitAdd} className="bg-muted/40 border border-border rounded-lg p-3 mb-3 grid grid-cols-2 md:grid-cols-7 gap-2 items-end">
          <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">Fase
            <select required value={addDraft.phase_type_id} onChange={(e) => setAddDraft((d) => ({ ...d, phase_type_id: e.target.value }))} className={inputCls}>
              <option value="">Velg…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">Navn (valgfritt)
            <input type="text" value={addDraft.name} onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))} placeholder="F.eks. Etappe 2" className={inputCls} />
          </label>
          <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">Start
            <input required type="date" value={addDraft.start} onChange={(e) => setAddDraft((d) => ({ ...d, start: e.target.value }))} className={inputCls} />
          </label>
          <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">Slutt
            <input type="date" value={addDraft.end} onChange={(e) => setAddDraft((d) => ({ ...d, end: e.target.value }))} className={inputCls} />
          </label>
          <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">Status
            <select value={addDraft.status} onChange={(e) => setAddDraft((d) => ({ ...d, status: e.target.value as Phase['status'] }))} className={inputCls}>
              {(Object.keys(STATUS_LABEL) as Phase['status'][]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">UE
            <select value={addDraft.subcontractor_id} onChange={(e) => setAddDraft((d) => ({ ...d, subcontractor_id: e.target.value }))} className={inputCls}>
              <option value="">Ingen</option>
              {projectUes.map((u) => <option key={u.id} value={u.id}>{u.company_name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={saving} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50">
            {saving ? 'Lagrer…' : 'Lagre fase'}
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          Ingen faser eller milepæler registrert ennå{manage && canManage ? ' — trykk «Rediger fremdriftsplan» for å legge til.' : '.'}
        </p>
      ) : (
        <>
          {/* Måneds-etiketter over tidslinjen — samme kolonnebredder som
              radene under, så de står rett over bar-sporet og månedslinjene. */}
          <div className="flex items-center gap-2 mb-1 print:hidden">
            <span className="w-28 flex-none" />
            <div className="flex-1 relative h-3">
              {monthSegs.map((s) => (
                <span key={s.mid} className="absolute -translate-x-1/2 text-[9px] text-[var(--color-text-muted)] whitespace-nowrap" style={{ left: `${pctPos(s.mid, min, max)}%` }}>{s.label}</span>
              ))}
            </div>
            <span className="w-[8.5rem] flex-none" />
            <span className="w-9 flex-none" />
            <span className="w-40 flex-none text-[9px] text-[var(--color-text-muted)] uppercase tracking-wide">Ansvarlig</span>
            <span className="w-16 flex-none text-[9px] text-[var(--color-text-muted)] uppercase tracking-wide text-right" title="Prognose-vekt: andel av inntekt/UE-kost fasen står for (tom = auto/varighet)">Vekt</span>
            {editMode && <span className="w-12 flex-none" />}
          </div>
          <div className={`relative space-y-1.5 ${dragging ? 'select-none cursor-ew-resize' : ''}`}>
          {rows.map((r) => {
            const isDeleted = deleted.has(r.id)
            const hasDraft = !!drafts[r.id]
            const dateLabel = r.end && r.end !== r.start
              ? `${fmtD(r.start)} – ${fmtD(r.end)}`
              : fmtD(r.start)
            const canEditRow = r.kind === 'phase' ? canTouchStatus : canManage
            const isEditing = editingId === r.id

            return (
              <div key={r.id}>
                <div className={`flex items-center gap-2 ${isDeleted ? 'opacity-40' : ''}`}>
                  <span className={`w-28 flex-none min-w-0 ${isDeleted ? 'line-through' : ''}`}>
                    <span className="block text-xs text-[var(--color-text-secondary)] truncate" title={r.label}>{r.label}</span>
                  </span>
                  <div data-track className="flex-1 relative h-3 rounded bg-muted overflow-hidden">
                    {/* Svakt måneds-rutenett bortover + «nå»-strek, aligna med
                        barene siden de deler samme min/max-koordinatrom. */}
                    {monthLines.map((ms) => (
                      <span key={ms} className="absolute top-0 bottom-0 w-px pointer-events-none" style={{ left: `${pctPos(ms, min, max)}%`, background: 'rgba(100,116,139,0.18)' }} />
                    ))}
                    {todayPct !== null && (
                      <span className="absolute top-0 bottom-0 w-px bg-red-400/70 z-10 pointer-events-none" style={{ left: `${todayPct}%` }} title="I dag" />
                    )}
                    <TimelineBar
                      item={r}
                      draggable={editMode && canManage && !isDeleted}
                      spanMs={span}
                      startDrag={startDrag}
                      className={`absolute top-0 bottom-0 rounded ${r.done ? 'opacity-40' : ''}`}
                      style={{ ...pos(r.start, r.end), backgroundColor: r.color }}
                      title={`${r.label}: ${dateLabel}${r.pctLabel && r.pctLabel !== '✓' ? ` · ${r.pctLabel}` : ''}${editMode && canManage && !isDeleted ? ' — dra for å flytte hele perioden' : ''}`}
                    />
                  </div>
                  <span className={`w-[8.5rem] flex-none text-right text-[10px] tabular-nums whitespace-nowrap ${hasDraft ? 'text-primary font-semibold' : 'text-[var(--color-text-muted)]'}`}>
                    {dateLabel}{hasDraft ? ' *' : ''}
                  </span>
                  <span className="w-9 flex-none text-right text-[10px] text-[var(--color-text-muted)] tabular-nums">
                    {r.pctLabel}
                  </span>
                  {/* Ansvarlig UE — egen kolonne, alltid redigerbar (lagrer straks).
                      Milepæler har ingen UE. Byggeleder ser navn (kan ikke tildele). */}
                  <span className="w-40 flex-none">
                    {r.kind === 'phase' && r.phase && (
                      canManage ? (
                        <select
                          value={r.phase.subcontractor_id ?? ''}
                          onChange={(e) => assignUe(r.phase!.id, e.target.value)}
                          disabled={assigningId === r.phase.id}
                          aria-label={`Ansvarlig for ${r.label}`}
                          className={`w-full px-1.5 py-1 text-[11px] border rounded focus:outline-none focus:border-primary disabled:opacity-50 ${
                            r.phase.subcontractor_id
                              ? 'border-border bg-card text-[var(--color-text-primary)]'
                              : 'border-amber-300 bg-amber-50 text-amber-800'
                          }`}
                        >
                          <option value="">Ingen ansvarlig</option>
                          {projectUes.map((u) => <option key={u.id} value={u.id}>{u.company_name}</option>)}
                        </select>
                      ) : (
                        <span className="block text-[10px] text-[var(--color-text-muted)] truncate" title={r.phase.subcontractor_id ? (ueMap.get(r.phase.subcontractor_id) ?? '') : ''}>
                          {r.phase.subcontractor_id ? (ueMap.get(r.phase.subcontractor_id) ?? '—') : '—'}
                        </span>
                      )
                    )}
                  </span>
                  {/* Vekt — prognose-vekt per fase, alltid redigerbar (lagrer straks).
                      Tom = auto (fasens varighet). Milepæler har ingen vekt. */}
                  <span className="w-16 flex-none">
                    {r.kind === 'phase' && r.phase && (
                      canManage ? (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          defaultValue={r.phase.weight ?? ''}
                          onBlur={(e) => {
                            const raw = e.target.value.trim()
                            const val = raw === '' ? null : Number(raw)
                            if (val !== null && (!Number.isFinite(val) || val < 0)) return
                            if (val !== (r.phase!.weight ?? null)) assignWeight(r.phase!.id, val)
                          }}
                          disabled={weightSavingId === r.phase.id}
                          placeholder="auto"
                          aria-label={`Vekt for ${r.label}`}
                          title="Prognose-vekt: andel av inntekt/UE-kost. Tom = auto (varighet)"
                          className="w-full px-1.5 py-1 text-[11px] text-right border border-border rounded bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary disabled:opacity-50"
                        />
                      ) : (
                        <span className="block text-[10px] text-[var(--color-text-muted)] text-right tabular-nums">
                          {r.phase.weight ?? 'auto'}
                        </span>
                      )
                    )}
                  </span>
                  {editMode && (
                    <span className="w-12 flex-none flex items-center justify-end gap-0.5 print:hidden">
                      {isDeleted ? (
                        <button
                          type="button"
                          onClick={() => setDeleted((prev) => { const n = new Set(prev); n.delete(r.id); return n })}
                          className="p-1 rounded text-[var(--color-text-muted)] hover:text-primary hover:bg-primary-soft"
                          title="Angre sletting"
                          aria-label={`Angre sletting av ${r.label}`}
                        >
                          <Undo2 size={12} />
                        </button>
                      ) : (
                        <>
                          {canEditRow && !isEditing && (
                            <button
                              type="button"
                              onClick={() => startEdit(r)}
                              className="p-1 rounded text-[var(--color-text-muted)] hover:text-primary hover:bg-primary-soft"
                              title={r.kind === 'phase' && !canManage ? 'Oppdater status/fremdrift' : `Rediger ${r.label}`}
                              aria-label={`Rediger ${r.label}`}
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          {canManage && !isEditing && (
                            <button
                              type="button"
                              onClick={() => setDeleted((prev) => { const n = new Set(prev); n.add(r.id); return n })}
                              className="p-1 rounded text-[var(--color-text-muted)] hover:text-danger hover:bg-danger-soft"
                              title={`Slett ${r.label} (lagres ved «Lagre»)`}
                              aria-label={`Slett ${r.label}`}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </>
                      )}
                    </span>
                  )}
                </div>

                {/* Inline-redigering under linjen → utkast */}
                {isEditing && editMode && (
                  <div className="my-1.5 ml-[7.5rem] bg-muted/40 border border-border rounded-lg p-2 flex items-end gap-2 flex-wrap print:hidden">
                    {r.kind === 'phase' && canManage && (
                      <>
                        <label className="text-[10px] text-[var(--color-text-muted)] flex flex-col gap-0.5">Fase
                          <select value={editDraft.phase_type_id} onChange={(e) => setEditDraft((d) => ({ ...d, phase_type_id: e.target.value }))} className={inputCls}>
                            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </label>
                        <label className="text-[10px] text-[var(--color-text-muted)] flex flex-col gap-0.5">Navn
                          <input type="text" value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Valgfritt" className={`${inputCls} w-28`} />
                        </label>
                      </>
                    )}
                    {r.kind === 'milestone' && (
                      <label className="text-[10px] text-[var(--color-text-muted)] flex flex-col gap-0.5">Navn
                        <input type="text" value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} className={`${inputCls} w-36`} />
                      </label>
                    )}
                    {(r.kind === 'milestone' || canManage) && (
                      <>
                        <label className="text-[10px] text-[var(--color-text-muted)] flex flex-col gap-0.5">Start
                          <input type="date" value={editDraft.start} onChange={(e) => setEditDraft((d) => ({ ...d, start: e.target.value }))} className={inputCls} />
                        </label>
                        <label className="text-[10px] text-[var(--color-text-muted)] flex flex-col gap-0.5">Slutt
                          <input type="date" value={editDraft.end} onChange={(e) => setEditDraft((d) => ({ ...d, end: e.target.value }))} className={inputCls} />
                        </label>
                      </>
                    )}
                    {r.kind === 'phase' && (
                      <>
                        <label className="text-[10px] text-[var(--color-text-muted)] flex flex-col gap-0.5">Status
                          <select value={editDraft.status} onChange={(e) => setEditDraft((d) => ({ ...d, status: e.target.value as Phase['status'] }))} className={inputCls}>
                            {(Object.keys(STATUS_LABEL) as Phase['status'][]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                          </select>
                        </label>
                        <label className="text-[10px] text-[var(--color-text-muted)] flex flex-col gap-0.5">Fremdrift %
                          <input type="number" min={0} max={100} value={editDraft.progress} onChange={(e) => setEditDraft((d) => ({ ...d, progress: e.target.value }))} className={`${inputCls} w-14 text-right`} />
                        </label>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => applyEditToDraft(r)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-primary text-white hover:bg-primary-hover"
                    >
                      <Check size={10} /> OK
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-border text-[var(--color-text-secondary)] hover:bg-muted"
                    >
                      <X size={10} /> Avbryt
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          </div>
        </>
      )}

      {editMode && changeCount > 0 && (
        <p className="mt-2 text-[10px] text-[var(--color-text-muted)] print:hidden">
          {changeCount} ulagret{changeCount === 1 ? ' endring' : 'e endringer'} (merket med *) — trykk «Lagre» for å skrive dem, «Avbryt» for å forkaste.
        </p>
      )}

      {/* Dato-tooltip som følger pekeren under draing */}
      {dragTip && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-900 text-white text-[10px] font-medium px-1.5 py-0.5 rounded shadow"
          style={{ left: dragTip.x + 12, top: dragTip.y - 26 }}
        >
          {dragTip.text}
        </div>
      )}
    </section>
  )
}
