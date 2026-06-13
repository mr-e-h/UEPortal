import { useRef, useState } from 'react'
import { fmtDateShort } from '@/lib/format'

/**
 * FREMDRIFTSPLAN-KJERNEN — én kilde for tidslinjelogikken.
 *
 * Brukes av BEGGE tidslinjeflatene (prosjektpanelet PhasesMiniStrip og
 * porteføljen FremdriftsplanClient). Endrer du semantikk her — punkt-
 * hendelser, dag-snapping, dra-oppførsel, statusetiketter — endres den
 * alle steder fremdriftsplanen vises. Ikke dupliser denne logikken i
 * komponentene.
 */

export type PhaseStatus = 'planned' | 'in_progress' | 'done'

export const STATUS_LABEL: Record<PhaseStatus, string> = {
  planned: 'Planlagt',
  in_progress: 'Pågår',
  done: 'Ferdig',
}

export const FALLBACK_COLOR = '#94A3B8'
export const DAY = 24 * 60 * 60 * 1000

export const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Felles elementformat for faser og milepæler på en tidslinje. */
export type TimelineItem = {
  id: string
  kind: 'phase' | 'milestone'
  rawId: string
  label: string
  color: string
  start: string
  end: string | null
  done: boolean
  status?: PhaseStatus
  progress?: number
}

/** Lokalt utkast per element — skrives først ved «Lagre». */
export type ItemDraft = {
  start?: string
  end?: string | null
  phase_type_id?: string
  name?: string
  status?: PhaseStatus
  progress?: number
}

/** Posisjon i % innenfor tidsspennet, klampet til [0, 100]. */
export function pctPos(dateMs: number, startMs: number, endMs: number): number {
  return Math.max(0, Math.min(100, ((dateMs - startMs) / (endMs - startMs)) * 100))
}

/**
 * Barens tidsspenn med PUNKT-semantikk: tom sluttdato = punkthendelse
 * (f.eks. leveringsdato) på én dag — ikke en lang strek.
 */
export function barSpanMs(startISO: string, endISO: string | null): { s: number; e: number } {
  const s = Date.parse(startISO)
  return { s, e: endISO ? Date.parse(endISO) : s + DAY }
}

type DragEdge = 'start' | 'end' | 'move'

type DragState = {
  item: TimelineItem
  edge: DragEdge
  startX: number
  msPerPx: number
  origStart: number
  origEnd: number
  curStart: number
  curEnd: number
}

/**
 * Dra-mekanikken for tidslinjebarer — identisk på alle flater:
 *   ender  = forleng/forkort (min én dag)
 *   midten = flytt hele perioden (lengden bevares)
 * Snapper til hele dager, viser dato-tooltip ved pekeren, og kaller
 * onPreview underveis + onCommit ved slipp (med endring). Lagring til API
 * eies av kalleren (utkast-modellen).
 *
 * Kalleren markerer sporet med data-track (bredden gir ms-per-piksel).
 */
export function useTimelineDrag(opts: {
  enabled: boolean
  onPreview: (itemId: string, startISO: string, endISO: string) => void
  onClearPreview: (itemId: string) => void
  onCommit: (item: TimelineItem, startISO: string, endISO: string) => void
}) {
  const [dragTip, setDragTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<DragState | null>(null)

  function startDrag(e: React.PointerEvent, item: TimelineItem, edge: DragEdge, spanMs: number) {
    if (!opts.enabled) return
    e.preventDefault()
    e.stopPropagation()
    const track = (e.currentTarget as HTMLElement).closest('[data-track]') as HTMLElement | null
    if (!track) return
    const width = track.getBoundingClientRect().width
    if (width <= 0) return
    const { s: origStart, e: origEnd } = barSpanMs(item.start, item.end)
    dragRef.current = {
      item, edge, startX: e.clientX, msPerPx: spanMs / width,
      origStart, origEnd, curStart: origStart, curEnd: origEnd,
    }
    setDragging(true)
    const tipFor = (s: number, en: number) =>
      edge === 'move'
        ? `${fmtDateShort(toISO(s))} – ${fmtDateShort(toISO(en))}`
        : fmtDateShort(toISO(edge === 'start' ? s : en))
    setDragTip({ x: e.clientX, y: e.clientY, text: tipFor(origStart, origEnd) })

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const deltaMs = Math.round(((ev.clientX - d.startX) * d.msPerPx) / DAY) * DAY
      let s = d.origStart
      let en = d.origEnd
      if (d.edge === 'start') s = Math.min(d.origStart + deltaMs, en - DAY)
      else if (d.edge === 'end') en = Math.max(d.origEnd + deltaMs, s + DAY)
      else { s = d.origStart + deltaMs; en = d.origEnd + deltaMs }
      d.curStart = s
      d.curEnd = en
      opts.onPreview(d.item.id, toISO(s), toISO(en))
      setDragTip({ x: ev.clientX, y: ev.clientY, text: tipFor(s, en) })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const d = dragRef.current
      dragRef.current = null
      setDragging(false)
      setDragTip(null)
      if (!d) return
      if (d.curStart !== d.origStart || d.curEnd !== d.origEnd) {
        opts.onCommit(d.item, toISO(d.curStart), toISO(d.curEnd))
      }
      opts.onClearPreview(d.item.id)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return { dragTip, dragging, startDrag }
}
