'use client'

import { useState } from 'react'
import TimelineBar from '@/components/fremdriftsplan/TimelineBar'
import {
  DAY, FALLBACK_COLOR, STATUS_LABEL, barSpanMs, pctPos,
  type TimelineItem,
} from '@/components/fremdriftsplan/core'
import { fmtDateShort } from '@/lib/format'
import type { PhaseType, ProjectPhase } from '@/types'

// ── Month helpers (mirroring PhasesMiniStrip) ────────────────────────────────

const MONTHS_ABBR = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']

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
      out.push({
        mid: (visStart + visEnd) / 2,
        label: showYear ? `${MONTHS_ABBR[m]} ${String(y).slice(2)}` : MONTHS_ABBR[m],
      })
      first = false
    }
    m++
    if (m > 11) { m = 0; y++ }
    segStart = next
  }
  return out
}

// ── No-op drag stub (read-only) ──────────────────────────────────────────────

function noopStartDrag() {
  // Read-only — drag is disabled; TimelineBar.draggable=false so this is never called.
}

// ── Component ────────────────────────────────────────────────────────────────

export interface UEFremdriftsplanProps {
  phases: ProjectPhase[]
  phaseTypes: PhaseType[]
  /** The logged-in UE's subcontractor_id — used to highlight own phases. */
  mySubId: string | null
  projectStart: string | null
  projectEnd: string | null
}

export default function UEFremdriftsplan({
  phases,
  phaseTypes,
  mySubId,
  projectStart,
  projectEnd,
}: UEFremdriftsplanProps) {
  const [onlyMine, setOnlyMine] = useState(false)

  const typeMap = new Map(phaseTypes.map((t) => [t.id, t]))

  // Build display rows — same logic as PhasesMiniStrip but read-only.
  const allRows: (TimelineItem & { pctLabel: string; isMine: boolean })[] = phases.map((p) => {
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
      status: p.status,
      progress: p.progress_percent,
      pctLabel: p.status === 'done' ? 'Ferdig' : p.progress_percent > 0 ? `${p.progress_percent}%` : STATUS_LABEL[p.status],
      isMine: !!mySubId && p.subcontractor_id === mySubId,
    }
  })

  const rows = onlyMine ? allRows.filter((r) => r.isMine) : allRows

  // Time span for scale — frozen to base data (no drafts here).
  const dates: number[] = []
  if (projectStart) dates.push(Date.parse(projectStart))
  if (projectEnd) dates.push(Date.parse(projectEnd))
  for (const r of allRows) {
    dates.push(Date.parse(r.start))
    if (r.end) dates.push(Date.parse(r.end))
  }

  const hasSpan = dates.length > 0
  const min = hasSpan ? Math.min(...dates) : 0
  const max = hasSpan ? Math.max(Math.max(...dates), min + 30 * DAY) : 1
  const span = max - min

  const monthLines = monthStartsBetween(min, max)
  const monthSegs = monthSegments(min, max)

  const today = Date.now()
  const todayPct = today >= min && today <= max ? ((today - min) / span) * 100 : null

  const pos = (startISO: string, endISO: string | null) => {
    const { s, e } = barSpanMs(startISO, endISO)
    return {
      left: `${pctPos(s, min, max)}%`,
      width: `${Math.max(1.5, ((Math.max(e, s + DAY) - s) / span) * 100)}%`,
    }
  }

  const hasOwnPhases = allRows.some((r) => r.isMine)

  if (rows.length === 0 && phases.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-muted)]">Ingen faser registrert ennå.</p>
    )
  }

  return (
    <div className="space-y-3">
      {/* Toggle — only shown when the UE actually has own phases */}
      {hasOwnPhases && (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={onlyMine}
              onClick={() => setOnlyMine((v) => !v)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 ${
                onlyMine ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  onlyMine ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-xs text-[var(--color-text-secondary)]">Vis kun mine faser</span>
          </label>
          {onlyMine && rows.length === 0 && (
            <span className="text-xs text-[var(--color-text-muted)]">Du har ingen egne faser på dette prosjektet.</span>
          )}
        </div>
      )}

      {rows.length === 0 && phases.length > 0 ? null : (
        <>
          {/* Month axis labels */}
          <div className="flex items-center gap-2 print:hidden">
            <span className="w-28 flex-none" />
            <div className="flex-1 relative h-3">
              {monthSegs.map((s) => (
                <span
                  key={s.mid}
                  className="absolute -translate-x-1/2 text-[9px] text-[var(--color-text-muted)] whitespace-nowrap"
                  style={{ left: `${pctPos(s.mid, min, max)}%` }}
                >
                  {s.label}
                </span>
              ))}
            </div>
            <span className="w-[8.5rem] flex-none" />
            <span className="w-16 flex-none" />
          </div>

          {/* Phase rows */}
          <div className="relative space-y-1.5">
            {rows.map((r) => {
              const dateLabel = r.end && r.end !== r.start
                ? `${fmtDateShort(r.start)} – ${fmtDateShort(r.end)}`
                : fmtDateShort(r.start)

              return (
                <div key={r.id} className="flex items-center gap-2">
                  {/* Label */}
                  <span
                    className={`w-28 flex-none text-xs truncate ${
                      r.isMine
                        ? 'font-semibold text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)]'
                    }`}
                    title={r.label}
                  >
                    {r.label}
                    {r.isMine && (
                      <span className="ml-1 text-[9px] font-medium text-primary bg-primary/10 px-1 py-0.5 rounded align-middle">
                        Mine
                      </span>
                    )}
                  </span>

                  {/* Track */}
                  <div
                    data-track
                    className="flex-1 relative h-3 rounded bg-muted overflow-hidden"
                  >
                    {/* Month grid lines */}
                    {monthLines.map((ms) => (
                      <span
                        key={ms}
                        className="absolute top-0 bottom-0 w-px pointer-events-none"
                        style={{ left: `${pctPos(ms, min, max)}%`, background: 'rgba(100,116,139,0.18)' }}
                      />
                    ))}

                    {/* Today line */}
                    {todayPct !== null && (
                      <span
                        className="absolute top-0 bottom-0 w-px bg-red-400/70 z-10 pointer-events-none"
                        style={{ left: `${todayPct}%` }}
                        title="I dag"
                      />
                    )}

                    <TimelineBar
                      item={r}
                      draggable={false}
                      spanMs={span}
                      startDrag={noopStartDrag}
                      className={`absolute top-0 bottom-0 rounded transition-opacity ${
                        r.done ? 'opacity-40' : r.isMine ? 'opacity-100 ring-1 ring-inset ring-white/30' : 'opacity-70'
                      }`}
                      style={{ ...pos(r.start, r.end), backgroundColor: r.color }}
                      title={`${r.label}: ${dateLabel}${r.pctLabel ? ` · ${r.pctLabel}` : ''}`}
                    />
                  </div>

                  {/* Date range */}
                  <span className="w-[8.5rem] flex-none text-right text-[10px] tabular-nums whitespace-nowrap text-[var(--color-text-muted)]">
                    {dateLabel}
                  </span>

                  {/* Progress / status label */}
                  <span className="w-16 flex-none text-right text-[10px] text-[var(--color-text-muted)] tabular-nums">
                    {r.pctLabel}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
