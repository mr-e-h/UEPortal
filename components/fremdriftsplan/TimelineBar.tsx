'use client'

import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { TimelineItem } from './core'

/**
 * Delt tidslinjebar for begge fremdriftsvisningene (prosjektpanelet og
 * porteføljeoversikten): den fargede baren + dra-mekanikken (midten flytter
 * hele perioden, endene forlenger/forkorter). Utseendet (høyde, hjørner,
 * posisjon) eies av forelderen via className/style — selve dra-oppførselen
 * og håndtakene bor ETT sted: her.
 */
export default function TimelineBar({
  item,
  draggable,
  spanMs,
  startDrag,
  className = '',
  style,
  title,
  children,
}: {
  item: TimelineItem
  /** true kun i redigeringsmodus for roller som kan flytte datoer. */
  draggable: boolean
  /** Visningens totale tidsspenn i ms (dra-matten trenger skalaen). */
  spanMs: number
  startDrag: (
    e: ReactPointerEvent,
    item: TimelineItem,
    edge: 'start' | 'end' | 'move',
    spanMs: number,
  ) => void
  /** Posisjon/form (absolute, høyde, runding, done-opacity) fra forelderen. */
  className?: string
  style?: CSSProperties
  title?: string
  children?: ReactNode
}) {
  return (
    <div
      onPointerDown={draggable ? (e) => startDrag(e, item, 'move', spanMs) : undefined}
      className={`${className} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={style}
      title={title}
    >
      {draggable && (
        <>
          <span
            onPointerDown={(e) => startDrag(e, item, 'start', spanMs)}
            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l bg-black/10 hover:bg-black/30 print:hidden"
            title="Dra for å endre startdato"
          />
          <span
            onPointerDown={(e) => startDrag(e, item, 'end', spanMs)}
            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r bg-black/10 hover:bg-black/30 print:hidden"
            title="Dra for å endre sluttdato"
          />
        </>
      )}
      {children}
    </div>
  )
}
