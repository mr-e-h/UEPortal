'use client'

import { useState } from 'react'
import type { GanttMilestone } from '@/types'

function toMs(date: string) { return new Date(date).getTime() }

function pct(date: string, startDate: string, endDate: string) {
  const ms = toMs(date), start = toMs(startDate), end = toMs(endDate)
  if (end === start) return 0
  return Math.max(0, Math.min(100, ((ms - start) / (end - start)) * 100))
}

function buildMonthHeaders(startDate: string, endDate: string) {
  const headers: { label: string; leftPct: number; widthPct: number }[] = []
  const totalMs = toMs(endDate) - toMs(startDate)
  if (totalMs <= 0) return headers
  const cursor = new Date(startDate)
  cursor.setDate(1)
  while (cursor.getTime() < toMs(endDate)) {
    const monthStart = new Date(cursor)
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    const clampedStart = Math.max(monthStart.getTime(), toMs(startDate))
    const clampedEnd = Math.min(monthEnd.getTime(), toMs(endDate))
    headers.push({
      label: monthStart.toLocaleDateString('nb-NO', { month: 'short', year: '2-digit' }),
      leftPct: ((clampedStart - toMs(startDate)) / totalMs) * 100,
      widthPct: ((clampedEnd - clampedStart) / totalMs) * 100,
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return headers
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' })
}

interface Props {
  milestones: GanttMilestone[]
  projectStart: string
  projectEnd: string | null
}

export default function GanttView({ milestones, projectStart, projectEnd }: Props) {
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null)

  if (milestones.length === 0) {
    return (
      <div className="p-6 text-center text-[var(--color-text-muted)] text-sm">
        Ingen milepæler registrert for dette prosjektet
      </div>
    )
  }

  const today = new Date().toISOString().split('T')[0]

  // Compute display range from project dates, falling back to milestone dates
  const allDates = milestones.flatMap((m) => [m.start_date, m.end_date])
  const minDate = allDates.reduce((a, b) => (a < b ? a : b))
  const maxDate = allDates.reduce((a, b) => (a > b ? a : b))

  const rawStart = projectStart && projectStart < minDate ? projectStart : minDate
  const rawEnd = projectEnd && projectEnd > maxDate ? projectEnd : maxDate

  const displayStart = (() => {
    const d = new Date(rawStart)
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().split('T')[0]
  })()
  const displayEnd = (() => {
    const d = new Date(rawEnd)
    d.setMonth(d.getMonth() + 1)
    return d.toISOString().split('T')[0]
  })()

  const monthHeaders = buildMonthHeaders(displayStart, displayEnd)
  const sorted = [...milestones].sort((a, b) => {
    if (a.start_date !== b.start_date) return a.start_date.localeCompare(b.start_date)
    return (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })
  const tooltipMilestone = tooltip ? milestones.find((m) => m.id === tooltip.id) : null

  return (
    <div className="relative overflow-x-auto select-none" onMouseLeave={() => setTooltip(null)}>
      {/* Month headers */}
      <div className="flex mb-2 ml-36">
        <div className="flex-1 relative h-6">
          {monthHeaders.map((h, i) => (
            <div
              key={i}
              className="absolute top-0 h-full flex items-center justify-center"
              style={{ left: `${h.leftPct}%`, width: `${h.widthPct}%` }}
            >
              <span className="text-[10px] font-medium text-[var(--color-text-muted)] truncate px-1">{h.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Milestone rows */}
      <div className="space-y-2">
        {sorted.map((m) => {
          const leftPct = pct(m.start_date, displayStart, displayEnd)
          const rightPct = pct(m.end_date, displayStart, displayEnd)
          const widthPct = Math.max(rightPct - leftPct, 0.5)
          const isPast = m.end_date < today
          const isActive = m.start_date <= today && m.end_date >= today

          return (
            <div key={m.id} className="flex items-center gap-2 min-h-[28px]">
              {/* Row label */}
              <div className="w-36 flex-none text-xs text-[var(--color-text-secondary)] truncate text-right pr-3 leading-tight">
                {m.title}
              </div>

              {/* Bar track */}
              <div className="flex-1 relative h-6">
                {/* Month grid lines */}
                {monthHeaders.map((h, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-border/40"
                    style={{ left: `${h.leftPct}%` }}
                  />
                ))}
                {/* Today line */}
                {today >= displayStart && today <= displayEnd && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-red-400/80 z-10"
                    style={{ left: `${pct(today, displayStart, displayEnd)}%` }}
                  />
                )}
                {/* Milestone bar */}
                <div
                  className="absolute top-0.5 h-5 rounded-md cursor-default transition-opacity hover:opacity-75"
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: m.color,
                    opacity: isPast ? 0.45 : 1,
                  }}
                  onMouseEnter={(e) => setTooltip({ id: m.id, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                />
              </div>

              {/* Status badge */}
              <div className="w-20 flex-none">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    isActive
                      ? 'bg-green-100 text-green-700'
                      : isPast
                      ? 'bg-gray-100 text-gray-500'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {isActive ? 'Pågår' : isPast ? 'Ferdig' : 'Kommende'}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Today legend */}
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
        <div className="w-4 h-px bg-red-400" />
        <span>I dag ({fmtDate(today)})</span>
      </div>

      {/* Tooltip */}
      {tooltip && tooltipMilestone && (
        <div
          className="fixed z-50 bg-white border border-border rounded-lg shadow-xl px-3 py-2 text-xs pointer-events-none space-y-0.5 min-w-[160px]"
          style={{ left: tooltip.x + 14, top: tooltip.y - 8 }}
        >
          <p className="font-semibold text-[var(--color-text-primary)]">{tooltipMilestone.title}</p>
          <p className="text-[var(--color-text-muted)]">
            {fmtDate(tooltipMilestone.start_date)}
            {tooltipMilestone.start_date !== tooltipMilestone.end_date &&
              ` – ${fmtDate(tooltipMilestone.end_date)}`}
          </p>
        </div>
      )}
    </div>
  )
}
