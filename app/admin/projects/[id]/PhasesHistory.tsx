'use client'

import { useEffect, useMemo, useState } from 'react'
import { History, Plus, Minus, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { DAY, pctPos } from '@/components/fremdriftsplan/core'
import { diffSnapshots, type DiffResolvers, type ItemChange } from '@/lib/phase-diff'
import type { ProjectPhaseVersion, PhaseType, Subcontractor } from '@/types'

/**
 * Fremdriftsplan-historikk: arkiv over versjoner (ett snapshot per lagring) med
 * hvem/når, en endringslogg (fra→til) per lagring, og et VISUELT overlegg der
 * den valgte (gamle) versjonen vises som svake «spøkelses»-barer bak den
 * nåværende (nye) planen. Leser kun — versjoner skrives av PhasesMiniStrip.
 */

const MONTHS_ABBR = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: '2-digit' }) +
    ' · ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
}

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
      out.push({ mid: (visStart + visEnd) / 2, label: first || m === 0 ? `${MONTHS_ABBR[m]} ${String(y).slice(2)}` : MONTHS_ABBR[m] })
      first = false
    }
    m++; if (m > 11) { m = 0; y++ }
    segStart = next
  }
  return out
}

export default function PhasesHistory({ projectId }: { projectId: string }) {
  const [versions, setVersions] = useState<ProjectPhaseVersion[]>([])
  const [types, setTypes] = useState<PhaseType[]>([])
  const [subs, setSubs] = useState<Subcontractor[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.projectPhaseVersions.list(projectId).catch(() => []),
      api.phaseTypes.list().catch(() => []),
      fetch('/api/subcontractors', { credentials: 'same-origin' }).then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([v, t, s]) => {
      if (cancelled) return
      const vs = Array.isArray(v) ? v as ProjectPhaseVersion[] : []
      setVersions(vs)
      setTypes(Array.isArray(t) ? t : [])
      setSubs(Array.isArray(s) ? s : [])
      // Standard: forrige versjon valgt, så overlegget viser siste endring (forrige → nå).
      setSelectedId(vs[1]?.id ?? vs[0]?.id ?? null)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [projectId])

  const resolvers: DiffResolvers = useMemo(() => {
    const typeMap = new Map(types.map((t) => [t.id, t.name]))
    const ueMap = new Map(subs.map((s) => [s.id, s.company_name]))
    return { phaseTypeName: (id) => typeMap.get(id), ueName: (id) => ueMap.get(id) }
  }, [types, subs])

  if (!loaded) return null

  if (versions.length === 0) {
    return (
      <section className="bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2 mb-1">
          <History size={15} /> Historikk
        </h2>
        <p className="text-xs text-[var(--color-text-muted)]">
          Ingen versjoner ennå. Endringer i fremdriftsplanen logges automatisk fra og med neste lagring.
        </p>
      </section>
    )
  }

  const latest = versions[0]
  const selected = versions.find((v) => v.id === selectedId) ?? versions[0]
  const isLatestSelected = selected.id === latest.id

  // Overlegg: valgt (gammel) vs nåværende (ny).
  const overlay = diffSnapshots(selected.snapshot, latest.snapshot, resolvers)
  const addedIds = new Set(overlay.phases.filter((c) => c.kind === 'added').map((c) => c.id))
  const removedIds = new Set(overlay.phases.filter((c) => c.kind === 'removed').map((c) => c.id))
  const changedIds = new Set(overlay.phases.filter((c) => c.kind === 'changed').map((c) => c.id))

  // Felles tidsskala over begge versjoner.
  const dates: number[] = []
  for (const snap of [selected.snapshot, latest.snapshot]) {
    for (const p of snap.phases ?? []) {
      if (p.start_date) dates.push(Date.parse(p.start_date))
      if (p.end_date) dates.push(Date.parse(p.end_date))
    }
  }
  const hasSpan = dates.length > 0
  const min = hasSpan ? Math.min(...dates) : 0
  const max = hasSpan ? Math.max(Math.max(...dates), min + 30 * DAY) : 1
  const span = max - min || 1
  const segs = monthSegments(min, max)
  const today = Date.now()
  const todayPct = today >= min && today <= max ? ((today - min) / span) * 100 : null

  const pos = (startISO: string, endISO: string | null) => {
    const s = Date.parse(startISO)
    const e = endISO ? Date.parse(endISO) : s
    return { left: `${pctPos(s, min, max)}%`, width: `${Math.max(1.5, ((Math.max(e, s + DAY) - s) / span) * 100)}%` }
  }

  // Rader = union av fase-id-er over begge versjoner, sortert på startdato.
  const idOrder: string[] = []
  const seen = new Set<string>()
  for (const p of [...(latest.snapshot.phases ?? []), ...(selected.snapshot.phases ?? [])]) {
    if (!seen.has(p.id)) { seen.add(p.id); idOrder.push(p.id) }
  }
  const newById = new Map((latest.snapshot.phases ?? []).map((p) => [p.id, p]))
  const oldById = new Map((selected.snapshot.phases ?? []).map((p) => [p.id, p]))
  const rows = idOrder
    .map((id) => ({ id, np: newById.get(id), op: oldById.get(id) }))
    .sort((a, b) => {
      const as = (a.np ?? a.op)?.start_date ?? ''
      const bs = (b.np ?? b.op)?.start_date ?? ''
      return as.localeCompare(bs)
    })

  const labelOf = (id: string): string => {
    const p = newById.get(id) ?? oldById.get(id)
    if (!p) return 'Fase'
    return p.name || resolvers.phaseTypeName?.(p.phase_type_id) || 'Fase'
  }

  return (
    <section className="bg-card border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
          <History size={15} /> Historikk
          <span className="text-xs font-normal text-[var(--color-text-muted)]">{versions.length} versjoner</span>
        </h2>
        <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-muted)]">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded bg-slate-400" /> Nå</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded border border-dashed border-slate-400 bg-slate-100" /> Valgt versjon</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded bg-green-500" /> Lagt til</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded bg-amber-400" /> Flyttet</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded bg-red-400" /> Fjernet</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[17rem_1fr] gap-4">
        {/* Versjonsliste (nyeste først) — hver rad = én lagring m/ hvem & antall endringer */}
        <ol className="space-y-1 lg:max-h-[22rem] overflow-y-auto pr-1">
          {versions.map((v, i) => {
            const prev = versions[i + 1]
            const d = diffSnapshots(prev?.snapshot, v.snapshot, resolvers)
            const isSel = v.id === selected.id
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                    isSel ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--color-text-primary)]">{fmtWhen(v.taken_at)}</span>
                    {i === 0 && <span className="text-[9px] uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded px-1">Nå</span>}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)] truncate">{v.taken_by_name || 'Ukjent'}</div>
                  <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                    {prev ? (d.total === 0 ? 'ingen endring' : `${d.total} endring${d.total === 1 ? '' : 'er'}`) : 'utgangspunkt'}
                  </div>
                </button>
              </li>
            )
          })}
        </ol>

        {/* Overlegg + endringslogg for valgt versjon mot nåværende */}
        <div className="min-w-0 space-y-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            {isLatestSelected
              ? 'Valgt versjon er den nåværende — velg en eldre versjon til venstre for å se forskjellen.'
              : <>Viser <span className="font-medium text-[var(--color-text-secondary)]">{fmtWhen(selected.taken_at)}</span> (spøkelse) mot nåværende plan.</>}
          </p>

          {/* Tidslinje med overlegg */}
          {rows.length > 0 && (
            <div className="border border-border rounded-lg p-3 overflow-hidden">
              {/* Måneds-akse */}
              <div className="flex items-center gap-2 mb-1">
                <span className="w-24 flex-none" />
                <div className="flex-1 relative h-3">
                  {segs.map((s) => (
                    <span key={s.mid} className="absolute -translate-x-1/2 text-[9px] text-[var(--color-text-muted)] whitespace-nowrap" style={{ left: `${pctPos(s.mid, min, max)}%` }}>{s.label}</span>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                {rows.map(({ id, np, op }) => {
                  const status = addedIds.has(id) ? 'added' : removedIds.has(id) ? 'removed' : changedIds.has(id) ? 'changed' : 'unchanged'
                  const solidColor = status === 'added' ? 'bg-green-500' : status === 'changed' ? 'bg-amber-400' : 'bg-slate-400'
                  const showGhost = !!op && (status === 'removed' || status === 'changed')
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <span className={`w-24 flex-none text-[11px] truncate ${status === 'removed' ? 'text-red-600 line-through' : 'text-[var(--color-text-secondary)]'}`} title={labelOf(id)}>
                        {labelOf(id)}
                      </span>
                      <div className="flex-1 relative h-5 rounded bg-muted">
                        {todayPct !== null && (
                          <span className="absolute top-0 bottom-0 w-px bg-red-400/70 z-20 pointer-events-none" style={{ left: `${todayPct}%` }} title="I dag" />
                        )}
                        {/* Spøkelse = gammel posisjon (bak) */}
                        {showGhost && op && (
                          <div
                            className="absolute top-0 h-5 rounded border border-dashed border-slate-400 bg-slate-200/50 z-0"
                            style={pos(op.start_date, op.end_date)}
                            title={`Gammel: ${op.start_date}${op.end_date ? ' – ' + op.end_date : ''}`}
                          />
                        )}
                        {/* Solid = ny posisjon (foran). Fjernet fase har ingen ny. */}
                        {np && (
                          <div
                            className={`absolute top-0.5 h-4 rounded z-10 ${solidColor}`}
                            style={pos(np.start_date, np.end_date)}
                            title={`Nå: ${np.start_date}${np.end_date ? ' – ' + np.end_date : ''}`}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Endringslogg (tekst, fra→til) for valgt versjon mot nåværende */}
          {!isLatestSelected && (
            <div className="space-y-1">
              {overlay.total === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">Ingen forskjell fra nåværende plan.</p>
              ) : (
                [...overlay.phases, ...overlay.milestones].map((c) => <ChangeLine key={c.id} c={c} />)
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function ChangeLine({ c }: { c: ItemChange }) {
  if (c.kind === 'added') {
    return <p className="text-xs text-green-700 flex items-center gap-1"><Plus size={11} className="flex-none" /> {c.label} <span className="text-[var(--color-text-muted)]">lagt til</span></p>
  }
  if (c.kind === 'removed') {
    return <p className="text-xs text-red-700 flex items-center gap-1"><Minus size={11} className="flex-none" /> {c.label} <span className="text-[var(--color-text-muted)]">fjernet</span></p>
  }
  return (
    <p className="text-xs text-[var(--color-text-secondary)]">
      <span className="font-medium text-[var(--color-text-primary)]">{c.label}:</span>{' '}
      {c.fields.map((f, i) => (
        <span key={f.field} className="whitespace-nowrap">
          {i > 0 && <span className="text-[var(--color-text-muted)]"> · </span>}
          {f.field} <span className="text-[var(--color-text-muted)]">{f.from}</span>
          <ArrowRight size={10} className="inline mx-0.5 -mt-0.5 text-[var(--color-text-muted)]" />
          <span className="text-[var(--color-text-primary)]">{f.to}</span>
        </span>
      ))}
    </p>
  )
}
