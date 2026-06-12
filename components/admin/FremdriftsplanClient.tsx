'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, ChevronLeft, Info, FileDown, Pencil, Check, X } from 'lucide-react'
import { printArea } from '@/lib/utils/print'
import { useMe } from '@/lib/useMe'

export type PhaseType = {
  id: string
  name: string
  color: string | null
  is_active: boolean
  sort_order: number
}

export type ProjectPhase = {
  id: string
  project_id: string
  phase_type_id: string
  name: string | null
  start_date: string
  end_date: string | null
  status: 'planned' | 'in_progress' | 'done'
  progress_percent: number
  sort_order: number
}

export type TimelineProject = {
  id: string
  name: string
  project_number: string
  county: string
  status: string
  start_date: string
  end_date: string | null
}

/** Gantt-milepæl (gantt_milestones) — samme innhold som prosjektfanens Gantt. */
export type TimelineMilestone = {
  id: string
  project_id: string
  title: string
  start_date: string
  end_date: string
  color: string | null
}

/** Felles barformat for faser og milepæler på tidslinjen. */
type TimelineItem = {
  id: string
  /** 'phase' | 'milestone' + rå id — trengs for inline-redigering. */
  kind: 'phase' | 'milestone'
  rawId: string
  label: string
  color: string
  start: string
  end: string | null
  done: boolean
  detail: string
  status?: ProjectPhase['status']
  progress?: number
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']
const STATUS_LABEL: Record<ProjectPhase['status'], string> = {
  planned: 'Planlagt',
  in_progress: 'Pågår',
  done: 'Ferdig',
}
const FALLBACK_COLOR = '#94A3B8'

/** Posisjon i % innenfor året, klampet til [0, 100]. */
function pct(dateMs: number, yearStartMs: number, yearEndMs: number): number {
  return Math.max(0, Math.min(100, ((dateMs - yearStartMs) / (yearEndMs - yearStartMs)) * 100))
}

/**
 * Porteføljetidslinje (MVP): månedsakse for valgt år, én rad per prosjekt med
 * prosjektperioden som dempet bakgrunnsbar og fasene som fargede bars.
 * Filtre: fasetyper (multi), prosjekt, område. Ekspander rad → fasedetaljer
 * med datoer/status/fremdrift. Ingen økonomi på siden.
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
  const canManage = !!me && ['main', 'company', 'project_manager'].includes(me.role)
  const isSiteManager = me?.role === 'byggeleder'

  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  // «Hele perioden»: ignorer årsgrensen — tidslinjen spenner fra tidligste
  // start til seneste slutt og blir bredere (horisontal scroll) ved behov.
  const [fullSpan, setFullSpan] = useState(false)
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [projectFilter, setProjectFilter] = useState('all')
  const [countyFilter, setCountyFilter] = useState('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Avhuking for sammenligning/PDF: hvilke prosjekter som er valgt, og om
  // listen skal begrenses til de valgte.
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [onlyChecked, setOnlyChecked] = useState(false)

  const yearStartMs = Date.parse(`${year}-01-01`)
  const yearEndMs = Date.parse(`${year}-12-31`)

  const typeById = useMemo(() => new Map(phaseTypes.map((t) => [t.id, t])), [phaseTypes])
  const phasesByProject = useMemo(() => {
    const m = new Map<string, ProjectPhase[]>()
    for (const ph of phases) {
      const arr = m.get(ph.project_id) ?? []
      arr.push(ph)
      m.set(ph.project_id, arr)
    }
    return m
  }, [phases])
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

  // Inline-redigering i detaljkolonnen.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ start: '', end: '', status: 'planned' as ProjectPhase['status'], progress: '0' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')

  function startEdit(it: TimelineItem) {
    setEditingId(it.id)
    setEditError('')
    setEditDraft({
      start: it.start,
      end: it.end ?? '',
      status: it.status ?? 'planned',
      progress: String(it.progress ?? 0),
    })
  }

  async function saveEdit(it: TimelineItem) {
    setSavingEdit(true); setEditError('')
    let res: Response
    if (it.kind === 'phase') {
      // Byggeleder: API-et avviser andre felter enn status/fremdrift.
      const body = canManage
        ? { start_date: editDraft.start, end_date: editDraft.end || null, status: editDraft.status, progress_percent: Number(editDraft.progress) || 0 }
        : { status: editDraft.status, progress_percent: Number(editDraft.progress) || 0 }
      res = await fetch(`/api/project-phases/${it.rawId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } else {
      res = await fetch('/api/milestones', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: it.rawId, start_date: editDraft.start, end_date: editDraft.end || editDraft.start }),
      })
    }
    setSavingEdit(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setEditError((d as { error?: string }).error ?? 'Lagring feilet')
      return
    }
    setEditingId(null)
    // Dataene er server-hentet (RSC) — refresh henter ferske props.
    router.refresh()
  }

  /** Samlet PDF: begrens til valgte (hvis noen), ekspander alt, print. */
  function exportPdf() {
    const ids = checked.size > 0 ? Array.from(checked) : rows.map((r) => r.id)
    if (checked.size > 0) setOnlyChecked(true)
    setExpanded(new Set(ids))
    printArea()
  }

  /** Kompakt dd.mm.åå for detaljkolonnen. */
  function fmtD(iso: string): string {
    const [y, m, d] = iso.split('-')
    return `${d}.${m}.${y.slice(2)}`
  }

  /** Overlapper valgt år? Åpen slutt = pågår ut året. Hele perioden = alt. */
  function inYear(startISO: string, endISO: string | null): boolean {
    if (fullSpan) return true
    const start = Date.parse(startISO)
    const end = endISO ? Date.parse(endISO) : yearEndMs
    return end >= yearStartMs && start <= yearEndMs
  }

  /**
   * Alle tidslinjeelementer for et prosjekt: faser + Gantt-milepæler i
   * felles format — samme innhold som prosjektets Fremdriftsplan-fane.
   * Fasetype-filteret gjelder faser; med aktivt filter skjules milepæler
   * (filteret betyr «vis kun disse fasetypene»).
   */
  function visibleItems(projectId: string): TimelineItem[] {
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
    // Tidligst startdato øverst — samme rekkefølge som prosjektpanelet.
    return [...phaseItems, ...msItems].sort((a, b) => a.start.localeCompare(b.start))
  }

  const rows = useMemo(() => {
    let list = projects
    if (onlyChecked && checked.size > 0) list = list.filter((p) => checked.has(p.id))
    if (projectFilter !== 'all') list = list.filter((p) => p.id === projectFilter)
    if (countyFilter !== 'all') list = list.filter((p) => p.county === countyFilter)
    // Prosjektperioden må berøre valgt år (åpen slutt = pågående) —
    // med mindre hele perioden vises.
    if (!fullSpan) {
      list = list.filter((p) => {
        const start = Date.parse(p.start_date)
        const end = p.end_date ? Date.parse(p.end_date) : Infinity
        return end >= yearStartMs && start <= yearEndMs
      })
    }
    // Med aktivt fasefilter: vis kun prosjekter som har minst én matchende
    // fase i året — det er sammenligningen på tvers man er ute etter.
    if (selectedTypes.size > 0) {
      list = list.filter((p) => visibleItems(p.id).length > 0)
    }
    // Tidligst oppstart øverst — «hva starter neste» leses ovenfra og ned.
    return [...list].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, projectFilter, countyFilter, selectedTypes, year, phases, milestones, onlyChecked, checked, fullSpan])

  // Tidslinjens spenn + månedskolonner. Årsmodus: 12 måneder i valgt år.
  // Hele perioden: fra første månedsstart til siste månedsslutt på tvers av
  // alle synlige prosjekter/faser/milepæler.
  const span = useMemo(() => {
    const yearMonths = MONTHS.map((label) => ({ label }))
    if (!fullSpan) return { startMs: yearStartMs, endMs: yearEndMs, months: yearMonths }
    let min = Infinity
    let max = -Infinity
    for (const p of rows) {
      min = Math.min(min, Date.parse(p.start_date))
      max = Math.max(max, p.end_date ? Date.parse(p.end_date) : Date.now())
      for (const it of visibleItems(p.id)) {
        min = Math.min(min, Date.parse(it.start))
        if (it.end) max = Math.max(max, Date.parse(it.end))
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
  }, [fullSpan, rows, yearStartMs, yearEndMs, phases, milestones, selectedTypes])

  // Felles kolonnegeometri: i hele perioden-modus får månedene fast bredde
  // og midtfeltet vokser (kortet scroller horisontalt).
  const monthGridStyle = { gridTemplateColumns: `repeat(${span.months.length}, minmax(0, 1fr))` }
  const timelineColStyle = fullSpan
    ? { width: `${span.months.length * 56}px`, flex: '0 0 auto' as const }
    : undefined

  return (
    <div className="p-6 space-y-5">
      {/* Topp: tittel + årvelger */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Fremdriftsplan</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            {rows.length} prosjekt{rows.length !== 1 ? 'er' : ''} {fullSpan ? '· hele perioden' : `i ${year}`}
          </p>
        </div>
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

      {/* Banner når fasetabellene ikke er aktivert (migrasjon 0002 ikke kjørt) */}
      {!phasesAvailable && (
        <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Info size={15} className="flex-none mt-0.5" />
          <span>
            Arbeidsfaser er ikke tilgjengelig ennå. Tidslinjen viser foreløpig prosjektperiodene.
          </span>
        </div>
      )}

      {/* Filtre */}
      <div className="space-y-3">
        {phasesAvailable && phaseTypes.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Faser:</span>
            {phaseTypes.filter((t) => t.is_active).map((t) => {
              const checked = selectedTypes.has(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleType(t.id)}
                  aria-pressed={checked}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    checked
                      ? 'border-transparent text-white'
                      : 'bg-card border-border text-[var(--color-text-secondary)] hover:bg-muted'
                  }`}
                  style={checked ? { backgroundColor: t.color ?? FALLBACK_COLOR } : undefined}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-none"
                    style={{ backgroundColor: checked ? 'rgba(255,255,255,0.85)' : (t.color ?? FALLBACK_COLOR) }}
                  />
                  {t.name}
                </button>
              )
            })}
            {selectedTypes.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTypes(new Set())}
                className="text-xs text-primary hover:underline"
              >
                Nullstill
              </button>
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card text-[var(--color-text-secondary)] hover:bg-muted disabled:opacity-50 ml-auto"
          >
            <FileDown size={13} /> Eksporter PDF{checked.size > 0 ? ` (${checked.size})` : ''}
          </button>
        </div>
      </div>

      {/* Tidslinje — print-area: kun denne (med print-headeren) havner i PDF */}
      <div className="print-area">
        {/* Header kun i PDF-en */}
        <div className="hidden print:block mb-3">
          <h1 className="text-lg font-bold text-black">Fremdriftsplan {year}</h1>
          <p className="text-xs text-gray-600">
            {rows.length} prosjekt{rows.length !== 1 ? 'er' : ''} · skrevet ut {new Date().toLocaleDateString('nb-NO')}
          </p>
        </div>
      <div className={`bg-card border border-border rounded-2xl ${fullSpan ? 'overflow-x-auto' : 'overflow-hidden'}`}>
        {/* Månedsheader + detaljkolonne */}
        <div className="flex border-b border-border bg-muted/40">
          <div className="w-56 flex-none px-4 py-2 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
            Prosjekt
          </div>
          <div className="flex-1 grid" style={{ ...monthGridStyle, ...timelineColStyle }}>
            {span.months.map((m, i) => (
              <div key={`${m.label}-${i}`} className="px-1 py-2 text-[10px] font-medium text-[var(--color-text-muted)] uppercase text-center border-l border-border/60 whitespace-nowrap overflow-hidden">
                {m.label}
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
            const projStart = Date.parse(p.start_date)
            const projEnd = p.end_date ? Date.parse(p.end_date) : span.endMs
            const left = pct(projStart, span.startMs, span.endMs)
            const right = pct(projEnd, span.startMs, span.endMs)
            const items = visibleItems(p.id)
            const projDates = `${fmtD(p.start_date)}${p.end_date ? ` – ${fmtD(p.end_date)}` : ' – pågående'}`

            // Ett spor per element i ekspandert visning — barer og detalj-
            // tabellen til høyre deler rekkefølge, så linje N = bar N.
            const LANE_H = 18
            const PAD = 12
            const cellH = isOpen ? Math.max(items.length, 1) * LANE_H + PAD : 44

            return (
              <div
                key={p.id}
                className="flex items-stretch border-b border-border last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
                onClick={() => toggleExpand(p.id)}
              >
                <div className="w-56 flex-none px-3 py-2.5 flex items-center gap-1.5 min-w-0">
                  {/* Avhuking for sammenligning/PDF — klikk på selve raden
                      ekspanderer, så checkboxen må stoppe propagering. */}
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
                <div className="flex-1 relative" style={{ minHeight: `${cellH}px`, ...timelineColStyle }}>
                  {/* Månedsgitter */}
                  <div className="absolute inset-0 grid pointer-events-none" style={monthGridStyle}>
                    {span.months.map((m, i) => (
                      <div key={`${m.label}-${i}`} className="border-l border-border/40" />
                    ))}
                  </div>
                  {!isOpen ? (
                    /* Kollapset: kun prosjektets varighet som én bar.
                       bg-primary-soft, ikke bg-primary/15 — opacity-
                       modifikatorer virker ikke på CSS-var-fargene våre. */
                    right > left && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full bg-primary-soft"
                        style={{ left: `${left}%`, width: `${Math.max(right - left, 0.5)}%` }}
                        title={`${p.name}: ${projDates}`}
                      />
                    )
                  ) : (
                    /* Ekspandert: én bar per spor, samme rekkefølge som
                       tabellen til høyre. Ingen bakgrunnsfelt. */
                    items.map((it, i) => {
                      const s = Date.parse(it.start)
                      const e = it.end ? Date.parse(it.end) : span.endMs
                      const l = pct(s, span.startMs, span.endMs)
                      const r = pct(e, span.startMs, span.endMs)
                      if (r <= l && !(s >= span.startMs && s <= span.endMs)) return null
                      return (
                        <div
                          key={it.id}
                          className={`absolute h-[7px] rounded-full ${it.done ? 'opacity-50' : ''}`}
                          style={{
                            left: `${l}%`,
                            width: `${Math.max(r - l, 0.8)}%`,
                            top: `${PAD / 2 + i * LANE_H + (LANE_H - 7) / 2}px`,
                            backgroundColor: it.color,
                          }}
                          title={`${it.label}: ${fmtD(it.start)}${it.end ? ` – ${fmtD(it.end)}` : ''} (${it.detail})`}
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
                    /* Kollapset: prosjektets varighet + antall elementer */
                    <div className="flex items-center gap-1.5 text-[10px] h-full">
                      <span className="text-[var(--color-text-muted)] whitespace-nowrap tabular-nums">{projDates}</span>
                      {items.length > 0 && (
                        <span className="text-[var(--color-text-muted)]">
                          · {items.length} element{items.length !== 1 ? 'er' : ''}
                        </span>
                      )}
                    </div>
                  ) : items.length === 0 ? (
                    <p className="text-[10px] text-[var(--color-text-muted)]" style={{ lineHeight: `${LANE_H}px` }}>
                      Ingen faser eller milepæler i {year}
                    </p>
                  ) : (
                    items.map((it) => {
                      const dateLabel = it.end && it.end !== it.start
                        ? `${fmtD(it.start)} – ${fmtD(it.end)}`
                        : fmtD(it.start)
                      const canEditItem = it.kind === 'phase' ? (canManage || isSiteManager) : canManage

                      if (editingId === it.id) {
                        const inputCls = 'px-1 py-0.5 text-[10px] border border-border rounded bg-card text-[var(--color-text-primary)]'
                        return (
                          <div key={it.id} className="py-1 space-y-1">
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: it.color }} />
                              <span className="font-medium text-[var(--color-text-primary)] truncate">{it.label}</span>
                            </div>
                            {/* Byggeleder kan ikke flytte datoer — kun status/fremdrift. */}
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
                            {editError && <p className="text-[10px] text-red-600">{editError}</p>}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => saveEdit(it)}
                                disabled={savingEdit}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
                              >
                                <Check size={10} /> Lagre
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
                          className="group flex items-center gap-1.5 text-[10px]"
                          style={{ height: `${LANE_H}px` }}
                          title={`${it.label}: ${dateLabel} (${it.detail})`}
                        >
                          <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: it.color }} />
                          <span className="font-medium text-[var(--color-text-primary)] truncate flex-1 min-w-0">{it.label}</span>
                          <span className="text-[var(--color-text-muted)] whitespace-nowrap tabular-nums">{dateLabel}</span>
                          {canEditItem && (
                            <button
                              type="button"
                              onClick={() => startEdit(it)}
                              className="flex-none p-0.5 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:text-primary print:hidden"
                              title={`Rediger ${it.label}`}
                              aria-label={`Rediger ${it.label}`}
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
      </div>
    </div>
  )
}
