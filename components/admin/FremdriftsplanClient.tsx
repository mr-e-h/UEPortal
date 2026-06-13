'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, ChevronLeft, Info, FileDown, Pencil, Check, X, Plus, Trash2, Undo2 } from 'lucide-react'
import { printArea } from '@/lib/utils/print'
import { useMe } from '@/lib/useMe'
import { fmtDateShort as fmtD } from '@/lib/format'
import { ADMIN_ROLES } from '@/lib/roles'
import { api, apiErrorMessage } from '@/lib/api'
import {
  DAY, FALLBACK_COLOR, STATUS_LABEL, pctPos as pct, useTimelineDrag,
  type TimelineItem as CoreItem, type ItemDraft,
} from '@/components/fremdriftsplan/core'
import TimelineBar from '@/components/fremdriftsplan/TimelineBar'

// Domenetypene bor i @/types — re-eksporteres her for eksisterende imports.
export type { PhaseType, ProjectPhase } from '@/types'
import type { PhaseType, ProjectPhase } from '@/types'

export type TimelineProject = {
  id: string
  name: string
  project_number: string
  county: string
  status: string
  start_date: string
  end_date: string | null
}

/** Gantt-milepæl (milestones-tabellen) — samme innhold som prosjektsiden. */
export type TimelineMilestone = {
  id: string
  project_id: string
  title: string
  start_date: string
  end_date: string
  color: string | null
}

/** Porteføljens element = kjernens element + detaljtekst. */
type TimelineItem = CoreItem & { detail: string }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']

/**
 * Porteføljetidslinje: månedsakse, én rad per prosjekt (tidligst oppstart
 * øverst), faser + milepæler som bars. Redigeringsmodus bak ÉN knapp —
 * dra ender/midten, blyant, slett (angre), «+ fase» per prosjekt — alt
 * samles som utkast og skrives først ved «Lagre» («Avbryt» forkaster).
 * Fasefilteret er planleggingsverktøyet: med f.eks. kun «Graving» valgt ser
 * man gravelinjene på tvers av ALLE prosjekter (også de uten graving), kan
 * finne hull og legge opp neste gravejobb der.
 */
export default function FremdriftsplanClient({
  projects,
  phases,
  phaseTypes,
  milestones,
  phasesAvailable,
}: {
  projects: TimelineProject[]
  phases: ProjectPhase[]
  phaseTypes: PhaseType[]
  milestones: TimelineMilestone[]
  phasesAvailable: boolean
}) {
  const router = useRouter()
  const { me } = useMe()
  // Samme rollegrenser som API-ene håndhever: admin-roller redigerer alt,
  // byggeleder kun fase-status/fremdrift (og ikke milepæler).
  const canManage = !!me && ADMIN_ROLES.includes(me.role)
  const canTouchStatus = canManage || me?.role === 'byggeleder'

  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [fullSpan, setFullSpan] = useState(false)
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [projectFilter, setProjectFilter] = useState('all')
  const [countyFilter, setCountyFilter] = useState('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [onlyChecked, setOnlyChecked] = useState(false)

  // ── Redigeringsmodus + utkast ───────────────────────────────────────
  const [editMode, setEditMode] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({})
  const [deleted, setDeleted] = useState<Set<string>>(new Set())
  // Faser opprettet via «+ fase» mens man redigerer (instant/additiv) —
  // vises uten å vente på server-refresh.
  const [addedPhases, setAddedPhases] = useState<ProjectPhase[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // «+ fase» per prosjektrad.
  const [addFor, setAddFor] = useState<string | null>(null)
  const [addTypeId, setAddTypeId] = useState('')
  const [addStart, setAddStart] = useState('')
  const [addEnd, setAddEnd] = useState('')

  // Dra-tilstand (kun redigeringsmodus) — kjernens dra-mekanikk.
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

  const yearStartMs = Date.parse(`${year}-01-01`)
  const yearEndMs = Date.parse(`${year}-12-31`)

  const typeById = useMemo(() => new Map(phaseTypes.map((t) => [t.id, t])), [phaseTypes])
  const phasesByProject = useMemo(() => {
    const m = new Map<string, ProjectPhase[]>()
    for (const ph of [...phases, ...addedPhases]) {
      const arr = m.get(ph.project_id) ?? []
      arr.push(ph)
      m.set(ph.project_id, arr)
    }
    return m
  }, [phases, addedPhases])
  const milestonesByProject = useMemo(() => {
    const m = new Map<string, TimelineMilestone[]>()
    for (const ms of milestones) {
      const arr = m.get(ms.project_id) ?? []
      arr.push(ms)
      m.set(ms.project_id, arr)
    }
    return m
  }, [milestones])

  const counties = useMemo(
    () => Array.from(new Set(projects.map((p) => p.county).filter(Boolean))).sort(),
    [projects],
  )

  function toggleType(id: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleChecked(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size === 0) setOnlyChecked(false)
      return next
    })
  }

  // Blyant (inline-skjema) — skriver til utkastet.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ start: '', end: '', status: 'planned' as ProjectPhase['status'], progress: '0' })

  function startEdit(it: TimelineItem) {
    setEditingId(it.id)
    setError('')
    setEditDraft({
      start: it.start,
      end: it.end ?? '',
      status: it.status ?? 'planned',
      progress: String(it.progress ?? 0),
    })
  }

  function applyEditToDraft(it: TimelineItem) {
    setDrafts((prev) => ({
      ...prev,
      [it.id]: it.kind === 'phase'
        ? (canManage
          ? { ...prev[it.id], start: editDraft.start, end: editDraft.end || null, status: editDraft.status, progress: Number(editDraft.progress) || 0 }
          : { ...prev[it.id], status: editDraft.status, progress: Number(editDraft.progress) || 0 })
        : { ...prev[it.id], start: editDraft.start, end: editDraft.end || editDraft.start },
    }))
    setEditingId(null)
  }

  // ── Redigeringsmodus inn/ut ─────────────────────────────────────────
  function enterEditMode() {
    setEditMode(true)
    // Ekspander alle synlige rader — redigering skjer på elementnivå.
    setExpanded(new Set(rows.map((p) => p.id)))
  }

  function cancelEditMode() {
    setDrafts({})
    setDeleted(new Set())
    setOverride({})
    setEditingId(null)
    setAddFor(null)
    setError('')
    setEditMode(false)
    // «+ fase»-opprettelser er allerede skrevet (additive) — synk via refresh.
    if (addedPhases.length > 0) {
      setAddedPhases([])
      router.refresh()
    }
  }

  const changeCount = new Set([...Object.keys(drafts), ...Array.from(deleted)]).size

  async function saveAll() {
    setSaving(true)
    setError('')
    const failures: string[] = []
    const itemById = new Map<string, TimelineItem>()
    for (const p of rows) for (const it of visibleItems(p.id, false)) itemById.set(it.id, it)

    for (const id of Array.from(deleted)) {
      const it = itemById.get(id)
      if (!it) continue
      try {
        if (it.kind === 'phase') await api.projectPhases.remove(it.rawId)
        else await api.milestones.remove(it.rawId)
      } catch {
        failures.push(`Slett ${it.label}`)
      }
    }

    for (const [id, d] of Object.entries(drafts)) {
      if (deleted.has(id)) continue
      const it = itemById.get(id)
      if (!it) continue
      try {
        if (it.kind === 'phase') {
          const body = canManage
            ? {
                ...(d.start !== undefined ? { start_date: d.start } : {}),
                ...(d.end !== undefined ? { end_date: d.end } : {}),
                ...(d.status !== undefined ? { status: d.status } : {}),
                ...(d.progress !== undefined ? { progress_percent: d.progress } : {}),
              }
            : {
                ...(d.status !== undefined ? { status: d.status } : {}),
                ...(d.progress !== undefined ? { progress_percent: d.progress } : {}),
              }
          await api.projectPhases.update(it.rawId, body)
        } else {
          await api.milestones.update({
            id: it.rawId,
            ...(d.start !== undefined ? { start_date: d.start } : {}),
            ...(d.end !== undefined ? { end_date: d.end ?? d.start } : {}),
          })
        }
      } catch (err) {
        failures.push(`${it.label}: ${apiErrorMessage(err, 'lagring feilet')}`)
      }
    }

    setSaving(false)
    setDrafts({})
    setDeleted(new Set())
    setEditingId(null)
    setAddFor(null)
    setAddedPhases([])
    if (failures.length > 0) {
      setError(`Noe feilet: ${failures.join(' · ')}`)
    } else {
      setEditMode(false)
    }
    router.refresh()
  }

  // «+ fase» — instant/additiv (utkastene beholdes).
  function openAdd(p: TimelineProject) {
    setAddFor(p.id)
    // Forhåndsvelg filtertypen når nøyaktig én er valgt — det er
    // planleggingsflyten («legg gravingen her»).
    const single = selectedTypes.size === 1 ? Array.from(selectedTypes)[0] : phaseTypes.filter((t) => t.is_active)[0]?.id ?? ''
    setAddTypeId(single)
    setAddStart(p.start_date)
    setAddEnd(p.end_date ?? '')
  }

  async function submitAdd(p: TimelineProject) {
    setSaving(true); setError('')
    let created: ProjectPhase
    try {
      created = await api.projectPhases.create({
        project_id: p.id,
        phase_type_id: addTypeId,
        name: null,
        start_date: addStart,
        end_date: addEnd || null,
        status: 'planned',
        progress_percent: 0,
      })
    } catch (err) {
      setSaving(false)
      setError(apiErrorMessage(err, 'Kunne ikke legge til fasen'))
      return
    }
    setSaving(false)
    setAddedPhases((prev) => [...prev, created])
    setAddFor(null)
  }

  /** Samlet PDF: begrens til valgte (hvis noen), ekspander alt, print. */
  function exportPdf() {
    const ids = checked.size > 0 ? Array.from(checked) : rows.map((r) => r.id)
    if (checked.size > 0) setOnlyChecked(true)
    setExpanded(new Set(ids))
    printArea()
  }

  /**
   * Prosjektets varighet SLIK PLANEN SIER DET: fra første fase-/milepælstart
   * til siste slutt. Prosjektets egne datoer brukes kun som fallback når
   * planen er tom.
   */
  function planSpan(projectId: string): { start: string; end: string | null } | null {
    const items = [
      ...(phasesByProject.get(projectId) ?? []).map((ph) => ({ s: ph.start_date, e: ph.end_date })),
      ...(milestonesByProject.get(projectId) ?? []).map((ms) => ({ s: ms.start_date, e: ms.end_date as string | null })),
    ]
    if (items.length === 0) return null
    let start = items[0].s
    let end: string | null = null
    for (const it of items) {
      if (it.s < start) start = it.s
      // Én dato (tom slutt) teller som punkt på startdatoen.
      const e = it.e ?? it.s
      if (!end || e > end) end = e
    }
    return { start, end }
  }

  /** Overlapper valgt år? Én dato (tom slutt) = punkthendelse på startdatoen. */
  function inYear(startISO: string, endISO: string | null): boolean {
    if (fullSpan) return true
    const start = Date.parse(startISO)
    const end = endISO ? Date.parse(endISO) : start + DAY
    return end >= yearStartMs && start <= yearEndMs
  }

  /**
   * Tidslinjeelementene for et prosjekt (faser + milepæler, tidligst først).
   * applyDrafts=true fletter inn ulagrede utkast + dra-overrides (visning);
   * false gir basisverdiene (tidsspenn + lagring).
   */
  function visibleItems(projectId: string, applyDrafts = true): TimelineItem[] {
    const phaseItems: TimelineItem[] = (phasesByProject.get(projectId) ?? [])
      .filter((ph) => {
        if (selectedTypes.size > 0 && !selectedTypes.has(ph.phase_type_id)) return false
        return inYear(ph.start_date, ph.end_date)
      })
      .map((ph) => {
        const t = typeById.get(ph.phase_type_id)
        return {
          id: `phase-${ph.id}`,
          kind: 'phase' as const,
          rawId: ph.id,
          label: ph.name ?? t?.name ?? 'Fase',
          color: t?.color ?? FALLBACK_COLOR,
          start: ph.start_date,
          end: ph.end_date,
          done: ph.status === 'done',
          detail: `${STATUS_LABEL[ph.status]}${ph.progress_percent > 0 ? ` · ${ph.progress_percent}%` : ''}`,
          status: ph.status,
          progress: ph.progress_percent,
        }
      })
    const msItems: TimelineItem[] = selectedTypes.size > 0 ? [] : (milestonesByProject.get(projectId) ?? [])
      .filter((ms) => inYear(ms.start_date, ms.end_date))
      .map((ms) => ({
        id: `ms-${ms.id}`,
        kind: 'milestone' as const,
        rawId: ms.id,
        label: ms.title,
        color: ms.color ?? FALLBACK_COLOR,
        start: ms.start_date,
        end: ms.end_date,
        done: false,
        detail: 'Milepæl',
      }))
    let items = [...phaseItems, ...msItems]
    if (applyDrafts) {
      items = items.map((it) => {
        const d = drafts[it.id]
        const o = override[it.id]
        if (!d && !o) return it
        const status = d?.status ?? it.status
        const progress = d?.progress ?? it.progress
        return {
          ...it,
          start: o?.start ?? d?.start ?? it.start,
          end: o !== undefined ? o.end : (d?.end !== undefined ? d.end : it.end),
          status,
          progress,
          done: it.kind === 'phase' ? status === 'done' : false,
          detail: it.kind === 'phase'
            ? `${STATUS_LABEL[status ?? 'planned']}${(progress ?? 0) > 0 ? ` · ${progress}%` : ''}`
            : it.detail,
        }
      })
    }
    return items.sort((a, b) => a.start.localeCompare(b.start))
  }

  const rows = useMemo(() => {
    let list = projects
    if (onlyChecked && checked.size > 0) list = list.filter((p) => checked.has(p.id))
    if (projectFilter !== 'all') list = list.filter((p) => p.id === projectFilter)
    if (countyFilter !== 'all') list = list.filter((p) => p.county === countyFilter)
    if (!fullSpan) {
      list = list.filter((p) => {
        const start = Date.parse(p.start_date)
        const end = p.end_date ? Date.parse(p.end_date) : Infinity
        return end >= yearStartMs && start <= yearEndMs
      })
    }
    // Med aktivt fasefilter vises ALLE prosjekter — også de uten matchende
    // fase. Tomme rader er selve poenget: der er hullet hvor neste jobb
    // (f.eks. graving) kan legges inn.
    // Sortering: tidligst PLANLAGT start øverst (planen, ikke prosjektdatoen).
    return [...list].sort((a, b) =>
      (planSpan(a.id)?.start ?? a.start_date ?? '').localeCompare(planSpan(b.id)?.start ?? b.start_date ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, projectFilter, countyFilter, year, onlyChecked, checked, fullSpan, phases, milestones, addedPhases])

  // Tidslinjens spenn + månedskolonner (basisverdier — utkast flytter ikke
  // skalaen under hånden).
  const span = useMemo(() => {
    const yearMonths = MONTHS.map((label) => ({ label }))
    if (!fullSpan) return { startMs: yearStartMs, endMs: yearEndMs, months: yearMonths }
    let min = Infinity
    let max = -Infinity
    // KUN de synlige radene styrer spennet (avhukede prosjekter med «Vis kun
    // valgte» = aksen tilpasser seg deres varighet) — og varigheten er
    // PLANENS spenn, ikke prosjektets sluttdato.
    for (const p of rows) {
      const ps = planSpan(p.id)
      min = Math.min(min, Date.parse(ps?.start ?? p.start_date))
      const endIso = ps?.end ?? p.end_date
      max = Math.max(max, endIso ? Date.parse(endIso) : Date.now())
      for (const it of visibleItems(p.id, false)) {
        min = Math.min(min, Date.parse(it.start))
        max = Math.max(max, it.end ? Date.parse(it.end) : Date.parse(it.start) + DAY)
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { startMs: yearStartMs, endMs: yearEndMs, months: yearMonths }
    }
    const s = new Date(min)
    const start = new Date(s.getFullYear(), s.getMonth(), 1)
    const e = new Date(max)
    const end = new Date(e.getFullYear(), e.getMonth() + 1, 1)
    const months: Array<{ label: string }> = []
    const cursor = new Date(start)
    while (cursor.getTime() < end.getTime() && months.length < 120) {
      months.push({
        label: `${MONTHS[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(2)}`,
      })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return { startMs: start.getTime(), endMs: end.getTime(), months }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullSpan, rows, yearStartMs, yearEndMs, phases, milestones, selectedTypes, addedPhases])

  // Alt klemmes inn i sidebredden uansett lengde — ingen horisontal scroll.
  // Ved mange måneder vises ikke hver etikett (gitterlinjene beholdes).
  const monthGridStyle = { gridTemplateColumns: `repeat(${span.months.length}, minmax(0, 1fr))` }
  const labelEvery = Math.max(1, Math.ceil(span.months.length / 12))

  const btnSecondary ='inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card text-[var(--color-text-secondary)] hover:bg-muted disabled:opacity-50'

  return (
    <div className="p-6 space-y-5">
      {/* Topp: tittel + årvelger + redigering */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Fremdriftsplan</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            {rows.length} prosjekt{rows.length !== 1 ? 'er' : ''} {fullSpan ? '· hele perioden' : `i ${year}`}
            {editMode && changeCount > 0 ? ` · ${changeCount} ulagret${changeCount === 1 ? ' endring' : 'e endringer'}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {phasesAvailable && canTouchStatus && (
            !editMode ? (
              <button
                type="button"
                onClick={enterEditMode}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-hover"
              >
                <Pencil size={13} /> Rediger fremdriftsplan
              </button>
            ) : (
              <>
                {canManage && (
                  <span className="text-[10px] text-[var(--color-text-muted)] print:hidden">
                    Dra i endene for å forlenge/forkorte, midten for å flytte
                  </span>
                )}
                <button
                  type="button"
                  onClick={saveAll}
                  disabled={saving || changeCount === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
                >
                  <Check size={13} /> {saving ? 'Lagrer…' : changeCount > 0 ? `Lagre (${changeCount})` : 'Lagre'}
                </button>
                <button type="button" onClick={cancelEditMode} disabled={saving} className={btnSecondary}>
                  <X size={13} /> Avbryt
                </button>
              </>
            )
          )}
          <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              disabled={fullSpan}
              className="p-1.5 text-[var(--color-text-secondary)] hover:bg-muted rounded-md disabled:opacity-30"
              aria-label="Forrige år"
            >
              <ChevronLeft size={14} />
            </button>
            <span className={`px-2 text-xs font-semibold ${fullSpan ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`}>{year}</span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              disabled={fullSpan}
              className="p-1.5 text-[var(--color-text-secondary)] hover:bg-muted rounded-md disabled:opacity-30"
              aria-label="Neste år"
            >
              <ChevronRight size={14} />
            </button>
            {year !== thisYear && !fullSpan && (
              <button
                type="button"
                onClick={() => setYear(thisYear)}
                className="px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft rounded-md"
              >
                I år
              </button>
            )}
            <button
              type="button"
              onClick={() => setFullSpan((v) => !v)}
              aria-pressed={fullSpan}
              title="Vis hele tidsspennet på tvers av år — planen blir bredere ved behov"
              className={`px-2 py-1 text-xs font-medium rounded-md ${
                fullSpan ? 'bg-primary text-white' : 'text-[var(--color-text-secondary)] hover:bg-muted'
              }`}
            >
              Hele perioden
            </button>
          </div>
        </div>
      </div>

      {/* Banner når fasetabellene ikke er aktivert (migrasjon 0002 ikke kjørt) */}
      {!phasesAvailable && (
        <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Info size={15} className="flex-none mt-0.5" />
          <span>
            Arbeidsfaser er ikke tilgjengelig ennå. Tidslinjen viser foreløpig prosjektperiodene.
          </span>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* Filtre */}
      <div className="space-y-3">
        {phasesAvailable && phaseTypes.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Faser:</span>
            {phaseTypes.filter((t) => t.is_active).map((t) => {
              const isOn = selectedTypes.has(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleType(t.id)}
                  aria-pressed={isOn}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    isOn
                      ? 'border-transparent text-white'
                      : 'bg-card border-border text-[var(--color-text-secondary)] hover:bg-muted'
                  }`}
                  style={isOn ? { backgroundColor: t.color ?? FALLBACK_COLOR } : undefined}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-none"
                    style={{ backgroundColor: isOn ? 'rgba(255,255,255,0.85)' : (t.color ?? FALLBACK_COLOR) }}
                  />
                  {t.name}
                </button>
              )
            })}
            {selectedTypes.size > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setSelectedTypes(new Set())}
                  className="text-xs text-primary hover:underline"
                >
                  Nullstill
                </button>
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  Alle prosjekter vises — tomme rader er hull der jobben kan legges inn
                </span>
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
          >
            <option value="all">Alle prosjekter</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {counties.length > 0 && (
            <select
              value={countyFilter}
              onChange={(e) => setCountyFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
            >
              <option value="all">Alle områder</option>
              {counties.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}

          {/* Valg + PDF: huk av prosjekter i lista for å sammenligne/eksportere */}
          {checked.size > 0 && (
            <>
              <span className="text-xs text-[var(--color-text-muted)]">{checked.size} valgt</span>
              <button
                type="button"
                onClick={() => setOnlyChecked((v) => !v)}
                aria-pressed={onlyChecked}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  onlyChecked
                    ? 'bg-primary text-white border-transparent'
                    : 'bg-card border-border text-[var(--color-text-secondary)] hover:bg-muted'
                }`}
              >
                Vis kun valgte
              </button>
              <button
                type="button"
                onClick={() => { setChecked(new Set()); setOnlyChecked(false) }}
                className="text-xs text-primary hover:underline"
              >
                Nullstill valg
              </button>
            </>
          )}
          <button
            type="button"
            onClick={exportPdf}
            disabled={rows.length === 0}
            title={checked.size > 0 ? `Eksporter de ${checked.size} valgte prosjektene som PDF` : 'Eksporter alle viste prosjekter som PDF'}
            className={`${btnSecondary} ml-auto`}
          >
            <FileDown size={13} /> Eksporter PDF{checked.size > 0 ? ` (${checked.size})` : ''}
          </button>
        </div>
      </div>

      {/* Tidslinje — print-area: kun denne (med print-headeren) havner i PDF */}
      <div className="print-area">
        {/* Header kun i PDF-en */}
        <div className="hidden print:block mb-3">
          <h1 className="text-lg font-bold text-black">Fremdriftsplan {fullSpan ? '' : year}</h1>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {rows.length} prosjekt{rows.length !== 1 ? 'er' : ''} · skrevet ut {new Date().toLocaleDateString('nb-NO')}
          </p>
        </div>
      <div className={`bg-card border border-border rounded-2xl overflow-hidden ${dragging ? 'select-none' : ''}`}>
        {/* Månedsheader + detaljkolonne */}
        <div className="flex border-b border-border bg-muted/40">
          <div className="w-56 flex-none px-4 py-2 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
            Prosjekt
          </div>
          <div className="flex-1 grid" style={monthGridStyle}>
            {span.months.map((m, i) => (
              <div key={`${m.label}-${i}`} className="px-1 py-2 text-[10px] font-medium text-[var(--color-text-muted)] uppercase text-center border-l border-border/60 whitespace-nowrap overflow-hidden">
                {i % labelEvery === 0 ? m.label : ''}
              </div>
            ))}
          </div>
          <div className="w-72 flex-none px-3 py-2 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest border-l border-border/60">
            Faser og milepæler
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
            Ingen prosjekter matcher filtrene i {year}
          </div>
        ) : (
          rows.map((p) => {
            const isOpen = expanded.has(p.id)
            // Lukket visning: varigheten PLANEN sier (første fasestart →
            // siste slutt) — prosjektets egne datoer kun som fallback.
            const ps = planSpan(p.id)
            const durStart = ps?.start ?? p.start_date
            const durEnd = ps ? ps.end : p.end_date
            const projStart = Date.parse(durStart)
            const projEnd = durEnd ? Date.parse(durEnd) : span.endMs
            const left = pct(projStart, span.startMs, span.endMs)
            const right = pct(projEnd, span.startMs, span.endMs)
            const items = visibleItems(p.id)
            const projDates = durEnd
              ? (durEnd === durStart ? fmtD(durStart) : `${fmtD(durStart)} – ${fmtD(durEnd)}`)
              : `${fmtD(durStart)} – pågående`

            // Ett spor per element i ekspandert visning — barer og detalj-
            // tabellen til høyre deler rekkefølge, så linje N = bar N.
            const LANE_H = 18
            const PAD = 12
            const cellH = isOpen ? Math.max(items.length, 1) * LANE_H + PAD : 44

            return (
              <div
                key={p.id}
                className={`flex items-stretch border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${editMode ? '' : 'cursor-pointer'}`}
                onClick={editMode ? undefined : () => toggleExpand(p.id)}
              >
                <div className="w-56 flex-none px-3 py-2.5 flex items-center gap-1.5 min-w-0">
                  <input
                    type="checkbox"
                    checked={checked.has(p.id)}
                    onChange={() => toggleChecked(p.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Velg ${p.name}`}
                    className="flex-none accent-[var(--color-primary,#2563eb)] print:hidden"
                  />
                  <span className="p-0.5 text-[var(--color-text-muted)] flex-none print:hidden" aria-hidden="true">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <div className="min-w-0">
                    <Link
                      href={`/admin/projects/${p.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="block text-xs font-medium text-[var(--color-text-primary)] truncate hover:text-primary hover:underline"
                    >
                      {p.name}
                    </Link>
                    <p className="text-[10px] text-[var(--color-text-muted)] truncate">
                      {p.project_number}{p.county ? ` · ${p.county}` : ''}
                    </p>
                  </div>
                </div>

                {/* Tidslinjecelle */}
                <div data-track className="flex-1 relative" style={{ minHeight: `${cellH}px` }}>
                  {/* Månedsgitter */}
                  <div className="absolute inset-0 grid pointer-events-none" style={monthGridStyle}>
                    {span.months.map((m, i) => (
                      <div key={`${m.label}-${i}`} className="border-l border-border/40" />
                    ))}
                  </div>
                  {!isOpen ? (
                    right > left && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full bg-primary-soft"
                        style={{ left: `${left}%`, width: `${Math.max(right - left, 0.5)}%` }}
                        title={`${p.name}: ${projDates}`}
                      />
                    )
                  ) : (
                    items.map((it, i) => {
                      if (deleted.has(it.id)) {
                        return (
                          <div
                            key={it.id}
                            className="absolute h-[7px] rounded-full opacity-20"
                            style={{
                              left: `${pct(Date.parse(it.start), span.startMs, span.endMs)}%`,
                              width: `${Math.max(pct(it.end ? Date.parse(it.end) : Date.parse(it.start) + DAY, span.startMs, span.endMs) - pct(Date.parse(it.start), span.startMs, span.endMs), 0.8)}%`,
                              top: `${PAD / 2 + i * LANE_H + (LANE_H - 7) / 2}px`,
                              backgroundColor: it.color,
                            }}
                          />
                        )
                      }
                      const s = Date.parse(it.start)
                      // Én dato (tom slutt) = punkthendelse — smal markør.
                      const e = it.end ? Date.parse(it.end) : s + DAY
                      const l = pct(s, span.startMs, span.endMs)
                      const r = pct(e, span.startMs, span.endMs)
                      if (r <= l && !(s >= span.startMs && s <= span.endMs)) return null
                      return (
                        <TimelineBar
                          key={it.id}
                          item={it}
                          draggable={editMode && canManage}
                          spanMs={span.endMs - span.startMs}
                          startDrag={startDrag}
                          className={`absolute h-[7px] rounded-full ${it.done ? 'opacity-50' : ''}`}
                          style={{
                            left: `${l}%`,
                            width: `${Math.max(r - l, 0.8)}%`,
                            top: `${PAD / 2 + i * LANE_H + (LANE_H - 7) / 2}px`,
                            backgroundColor: it.color,
                          }}
                          title={`${it.label}: ${fmtD(it.start)}${it.end ? ` – ${fmtD(it.end)}` : ''} (${it.detail})${editMode && canManage ? ' — dra for å flytte' : ''}`}
                        />
                      )
                    })
                  )}
                </div>

                {/* Detaljkolonne helt til høyre — klikk her skal ikke
                    kollapse raden (redigeringsskjema bor her). */}
                <div
                  className="w-72 flex-none border-l border-border/60 px-3"
                  style={{ paddingTop: `${PAD / 2}px`, paddingBottom: `${PAD / 2}px` }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {!isOpen ? (
                    <div className="flex items-center gap-1.5 text-[10px] h-full">
                      <span className="text-[var(--color-text-muted)] whitespace-nowrap tabular-nums">{projDates}</span>
                      {items.length > 0 && (
                        <span className="text-[var(--color-text-muted)]">
                          · {items.length} element{items.length !== 1 ? 'er' : ''}
                        </span>
                      )}
                    </div>
                  ) : (
                    <>
                      {items.length === 0 && (
                        <p className="text-[10px] text-[var(--color-text-muted)]" style={{ lineHeight: `${LANE_H}px` }}>
                          {selectedTypes.size > 0 ? 'Ingen valgte faser her ennå' : `Ingen faser eller milepæler i ${fullSpan ? 'perioden' : year}`}
                        </p>
                      )}
                      {items.map((it) => {
                        const isDeleted = deleted.has(it.id)
                        const hasDraft = !!drafts[it.id]
                        const dateLabel = it.end && it.end !== it.start
                          ? `${fmtD(it.start)} – ${fmtD(it.end)}`
                          : fmtD(it.start)
                        const canEditItem = it.kind === 'phase' ? canTouchStatus : canManage

                        if (editingId === it.id && editMode) {
                          const inputCls = 'px-1 py-0.5 text-[10px] border border-border rounded bg-card text-[var(--color-text-primary)]'
                          return (
                            <div key={it.id} className="py-1 space-y-1">
                              <div className="flex items-center gap-1.5 text-[10px]">
                                <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: it.color }} />
                                <span className="font-medium text-[var(--color-text-primary)] truncate">{it.label}</span>
                              </div>
                              {(it.kind === 'milestone' || canManage) && (
                                <div className="flex items-center gap-1">
                                  <input type="date" value={editDraft.start} onChange={(e) => setEditDraft((d) => ({ ...d, start: e.target.value }))} className={inputCls} />
                                  <span className="text-[10px] text-[var(--color-text-muted)]">–</span>
                                  <input type="date" value={editDraft.end} onChange={(e) => setEditDraft((d) => ({ ...d, end: e.target.value }))} className={inputCls} />
                                </div>
                              )}
                              {it.kind === 'phase' && (
                                <div className="flex items-center gap-1">
                                  <select
                                    value={editDraft.status}
                                    onChange={(e) => setEditDraft((d) => ({ ...d, status: e.target.value as ProjectPhase['status'] }))}
                                    className={inputCls}
                                  >
                                    {(Object.keys(STATUS_LABEL) as ProjectPhase['status'][]).map((s) => (
                                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="number" min={0} max={100}
                                    value={editDraft.progress}
                                    onChange={(e) => setEditDraft((d) => ({ ...d, progress: e.target.value }))}
                                    className={`${inputCls} w-12 text-right`}
                                  />
                                  <span className="text-[10px] text-[var(--color-text-muted)]">%</span>
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => applyEditToDraft(it)}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-primary text-white hover:bg-primary-hover"
                                >
                                  <Check size={10} /> OK
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-border text-[var(--color-text-secondary)] hover:bg-muted"
                                >
                                  <X size={10} /> Avbryt
                                </button>
                              </div>
                            </div>
                          )
                        }

                        return (
                          <div
                            key={it.id}
                            className={`flex items-center gap-1.5 text-[10px] ${isDeleted ? 'opacity-40' : ''}`}
                            style={{ height: `${LANE_H}px` }}
                            title={`${it.label}: ${dateLabel} (${it.detail})`}
                          >
                            <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: it.color }} />
                            <span className={`font-medium text-[var(--color-text-primary)] truncate flex-1 min-w-0 ${isDeleted ? 'line-through' : ''}`}>{it.label}</span>
                            <span className={`whitespace-nowrap tabular-nums ${hasDraft ? 'text-primary font-semibold' : 'text-[var(--color-text-muted)]'}`}>
                              {dateLabel}{hasDraft ? ' *' : ''}
                            </span>
                            {editMode && (
                              <span className="flex-none flex items-center gap-0.5 print:hidden">
                                {isDeleted ? (
                                  <button
                                    type="button"
                                    onClick={() => setDeleted((prev) => { const n = new Set(prev); n.delete(it.id); return n })}
                                    className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-primary hover:bg-primary-soft"
                                    title="Angre sletting"
                                    aria-label={`Angre sletting av ${it.label}`}
                                  >
                                    <Undo2 size={11} />
                                  </button>
                                ) : (
                                  <>
                                    {canEditItem && (
                                      <button
                                        type="button"
                                        onClick={() => startEdit(it)}
                                        className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-primary hover:bg-primary-soft"
                                        title={it.kind === 'phase' && !canManage ? 'Oppdater status/fremdrift' : `Rediger ${it.label}`}
                                        aria-label={`Rediger ${it.label}`}
                                      >
                                        <Pencil size={11} />
                                      </button>
                                    )}
                                    {canManage && (
                                      <button
                                        type="button"
                                        onClick={() => setDeleted((prev) => { const n = new Set(prev); n.add(it.id); return n })}
                                        className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-danger hover:bg-danger-soft"
                                        title={`Slett ${it.label} (lagres ved «Lagre»)`}
                                        aria-label={`Slett ${it.label}`}
                                      >
                                        <Trash2 size={11} />
                                      </button>
                                    )}
                                  </>
                                )}
                              </span>
                            )}
                          </div>
                        )
                      })}

                      {/* «+ fase» — legg jobben inn der hullet er */}
                      {editMode && canManage && (
                        addFor === p.id ? (
                          <div className="flex items-center gap-1 flex-wrap py-1 print:hidden">
                            <select
                              value={addTypeId}
                              onChange={(e) => setAddTypeId(e.target.value)}
                              className="px-1 py-0.5 text-[10px] border border-border rounded bg-card text-[var(--color-text-primary)]"
                            >
                              {phaseTypes.filter((t) => t.is_active).map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                            <input type="date" value={addStart} onChange={(e) => setAddStart(e.target.value)} className="px-1 py-0.5 text-[10px] border border-border rounded bg-card text-[var(--color-text-primary)]" />
                            <input type="date" value={addEnd} onChange={(e) => setAddEnd(e.target.value)} className="px-1 py-0.5 text-[10px] border border-border rounded bg-card text-[var(--color-text-primary)]" />
                            <button
                              type="button"
                              onClick={() => submitAdd(p)}
                              disabled={saving || !addTypeId || !addStart}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
                            >
                              <Check size={10} /> Legg til
                            </button>
                            <button
                              type="button"
                              onClick={() => setAddFor(null)}
                              className="p-0.5 rounded text-[var(--color-text-muted)] hover:bg-muted"
                              aria-label="Avbryt ny fase"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openAdd(p)}
                            className="inline-flex items-center gap-1 mt-0.5 text-[10px] font-medium text-primary hover:underline print:hidden"
                          >
                            <Plus size={10} /> fase
                          </button>
                        )
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
      </div>

      {/* Dato-tooltip som følger pekeren under draing */}
      {dragTip && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-900 text-white text-[10px] font-medium px-1.5 py-0.5 rounded shadow"
          style={{ left: dragTip.x + 12, top: dragTip.y - 26 }}
        >
          {dragTip.text}
        </div>
      )}
    </div>
  )
}
