'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ChevronLeft, Info } from 'lucide-react'

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
  phasesAvailable,
}: {
  projects: TimelineProject[]
  phases: ProjectPhase[]
  phaseTypes: PhaseType[]
  phasesAvailable: boolean
}) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [projectFilter, setProjectFilter] = useState('all')
  const [countyFilter, setCountyFilter] = useState('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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

  /** Fase synlig i valgt år + evt. fasetype-filter. Åpen slutt = pågår ut året. */
  function visiblePhases(projectId: string): ProjectPhase[] {
    const list = phasesByProject.get(projectId) ?? []
    return list.filter((ph) => {
      if (selectedTypes.size > 0 && !selectedTypes.has(ph.phase_type_id)) return false
      const start = Date.parse(ph.start_date)
      const end = ph.end_date ? Date.parse(ph.end_date) : yearEndMs
      return end >= yearStartMs && start <= yearEndMs
    })
  }

  const rows = useMemo(() => {
    let list = projects
    if (projectFilter !== 'all') list = list.filter((p) => p.id === projectFilter)
    if (countyFilter !== 'all') list = list.filter((p) => p.county === countyFilter)
    // Prosjektperioden må berøre valgt år (åpen slutt = pågående).
    list = list.filter((p) => {
      const start = Date.parse(p.start_date)
      const end = p.end_date ? Date.parse(p.end_date) : Infinity
      return end >= yearStartMs && start <= yearEndMs
    })
    // Med aktivt fasefilter: vis kun prosjekter som har minst én matchende
    // fase i året — det er sammenligningen på tvers man er ute etter.
    if (selectedTypes.size > 0) {
      list = list.filter((p) => visiblePhases(p.id).length > 0)
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, projectFilter, countyFilter, selectedTypes, year, phases])

  return (
    <div className="p-6 space-y-5">
      {/* Topp: tittel + årvelger */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Fremdriftsplan</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            {rows.length} prosjekt{rows.length !== 1 ? 'er' : ''} i {year}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setYear((y) => y - 1)}
            className="p-1.5 text-[var(--color-text-secondary)] hover:bg-muted rounded-md"
            aria-label="Forrige år"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="px-2 text-xs font-semibold text-[var(--color-text-primary)]">{year}</span>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            className="p-1.5 text-[var(--color-text-secondary)] hover:bg-muted rounded-md"
            aria-label="Neste år"
          >
            <ChevronRight size={14} />
          </button>
          {year !== thisYear && (
            <button
              type="button"
              onClick={() => setYear(thisYear)}
              className="px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft rounded-md"
            >
              I år
            </button>
          )}
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
        </div>
      </div>

      {/* Tidslinje */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {/* Månedsheader */}
        <div className="flex border-b border-border bg-muted/40">
          <div className="w-56 flex-none px-4 py-2 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
            Prosjekt
          </div>
          <div className="flex-1 grid grid-cols-12">
            {MONTHS.map((m) => (
              <div key={m} className="px-1 py-2 text-[10px] font-medium text-[var(--color-text-muted)] uppercase text-center border-l border-border/60">
                {m}
              </div>
            ))}
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
            const projEnd = p.end_date ? Date.parse(p.end_date) : yearEndMs
            const left = pct(projStart, yearStartMs, yearEndMs)
            const right = pct(projEnd, yearStartMs, yearEndMs)
            const phs = visiblePhases(p.id)

            return (
              <div key={p.id} className="border-b border-border last:border-0">
                {/* Prosjektrad */}
                <div className="flex items-stretch hover:bg-muted/40 transition-colors">
                  <div className="w-56 flex-none px-3 py-2.5 flex items-center gap-1.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleExpand(p.id)}
                      className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] flex-none"
                      aria-label={isOpen ? 'Lukk detaljer' : 'Vis detaljer'}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <div className="min-w-0">
                      <Link
                        href={`/admin/projects/${p.id}`}
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
                  <div className="flex-1 relative min-h-[44px]">
                    {/* Månedsgitter */}
                    <div className="absolute inset-0 grid grid-cols-12 pointer-events-none">
                      {MONTHS.map((m) => (
                        <div key={m} className="border-l border-border/40" />
                      ))}
                    </div>
                    {/* Prosjektperiode (dempet bakgrunnsbar). bg-primary-soft,
                        ikke bg-primary/15 — opacity-modifikatorer virker ikke
                        på CSS-var-fargene våre. */}
                    {right > left && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full bg-primary-soft"
                        style={{ left: `${left}%`, width: `${Math.max(right - left, 0.5)}%` }}
                        title={`${p.name}: ${p.start_date} – ${p.end_date ?? 'pågående'}`}
                      />
                    )}
                    {/* Fasebars */}
                    {phs.map((ph, i) => {
                      const t = typeById.get(ph.phase_type_id)
                      const s = Date.parse(ph.start_date)
                      const e = ph.end_date ? Date.parse(ph.end_date) : yearEndMs
                      const l = pct(s, yearStartMs, yearEndMs)
                      const r = pct(e, yearStartMs, yearEndMs)
                      if (r <= l && !(s >= yearStartMs && s <= yearEndMs)) return null
                      // Stable lanes: fordel fasene på 2 «spor» så overlappende
                      // faser ikke dekker hverandre helt.
                      const lane = i % 2
                      return (
                        <div
                          key={ph.id}
                          className={`absolute h-[7px] rounded-full ${ph.status === 'done' ? 'opacity-50' : ''}`}
                          style={{
                            left: `${l}%`,
                            width: `${Math.max(r - l, 0.8)}%`,
                            top: lane === 0 ? '8px' : 'calc(100% - 15px)',
                            backgroundColor: t?.color ?? FALLBACK_COLOR,
                          }}
                          title={`${ph.name ?? t?.name ?? 'Fase'}: ${ph.start_date} – ${ph.end_date ?? 'åpen'} (${STATUS_LABEL[ph.status]}${ph.progress_percent > 0 ? `, ${ph.progress_percent}%` : ''})`}
                        />
                      )
                    })}
                  </div>
                </div>

                {/* Ekspandert: fasedetaljer */}
                {isOpen && (
                  <div className="pl-[4.5rem] pr-4 pb-3 bg-muted/20">
                    {phs.length === 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)] py-1.5">
                        {phasesAvailable ? 'Ingen faser registrert for dette prosjektet i valgt år.' : 'Faser er ikke aktivert ennå.'}
                      </p>
                    ) : (
                      <ul className="space-y-1 pt-1">
                        {phs.map((ph) => {
                          const t = typeById.get(ph.phase_type_id)
                          return (
                            <li key={ph.id} className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                              <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ backgroundColor: t?.color ?? FALLBACK_COLOR }} />
                              <span className="font-medium text-[var(--color-text-primary)]">{ph.name ?? t?.name ?? 'Fase'}</span>
                              <span className="text-[var(--color-text-muted)]">
                                {ph.start_date} – {ph.end_date ?? 'åpen'} · {STATUS_LABEL[ph.status]}
                                {ph.progress_percent > 0 ? ` · ${ph.progress_percent}%` : ''}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
