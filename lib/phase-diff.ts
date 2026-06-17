import type { ProjectPhase, GanttMilestone, ProjectPhaseSnapshot } from '@/types'
import { fmtDateShort } from '@/lib/format'

/**
 * Diff av fremdriftsplan-versjoner: sammenlign to snapshots og produser en
 * lesbar endringsliste (hvem-delen kommer fra versjonens taken_by). Brukes både
 * til endringsloggen (tekst fra→til) og til å fargelegge overlegg-tidslinjen.
 *
 * Faser matches på id (stabil), så omdøping/flytting spores som ENDRING, ikke
 * slett+ny. Datoer slås sammen til «Periode» så loggen leses naturlig.
 */

const STATUS_TXT: Record<string, string> = { planned: 'Planlagt', in_progress: 'Pågår', done: 'Ferdig' }

export interface FieldChange { field: string; from: string; to: string }
export interface ItemChange {
  id: string
  label: string
  kind: 'added' | 'removed' | 'changed'
  fields: FieldChange[]
}
export interface SnapshotDiff {
  phases: ItemChange[]
  milestones: ItemChange[]
  total: number
}

export interface DiffResolvers {
  phaseTypeName?: (id: string) => string | undefined
  ueName?: (id: string) => string | undefined
}

function phaseLabel(p: ProjectPhase, r?: DiffResolvers): string {
  return p.name || (p.phase_type_id ? (r?.phaseTypeName?.(p.phase_type_id) ?? '') : '') || 'Fase'
}
function period(start: string, end: string | null): string {
  return end && end !== start ? `${fmtDateShort(start)} – ${fmtDateShort(end)}` : fmtDateShort(start)
}
const weightTxt = (w: number | null | undefined): string => (w == null ? 'auto' : String(w))

function diffPhase(o: ProjectPhase, n: ProjectPhase, r?: DiffResolvers): FieldChange[] {
  const out: FieldChange[] = []
  if (o.start_date !== n.start_date || (o.end_date ?? '') !== (n.end_date ?? '')) {
    out.push({ field: 'Periode', from: period(o.start_date, o.end_date), to: period(n.start_date, n.end_date) })
  }
  if (o.status !== n.status) {
    out.push({ field: 'Status', from: STATUS_TXT[o.status] ?? o.status, to: STATUS_TXT[n.status] ?? n.status })
  }
  if ((o.progress_percent ?? 0) !== (n.progress_percent ?? 0)) {
    out.push({ field: 'Fremdrift', from: `${o.progress_percent ?? 0} %`, to: `${n.progress_percent ?? 0} %` })
  }
  if ((o.subcontractor_id ?? '') !== (n.subcontractor_id ?? '')) {
    out.push({
      field: 'Ansvarlig',
      from: o.subcontractor_id ? (r?.ueName?.(o.subcontractor_id) ?? o.subcontractor_id) : 'Ingen',
      to: n.subcontractor_id ? (r?.ueName?.(n.subcontractor_id) ?? n.subcontractor_id) : 'Ingen',
    })
  }
  if ((o.weight ?? null) !== (n.weight ?? null)) {
    out.push({ field: 'Vekt', from: weightTxt(o.weight), to: weightTxt(n.weight) })
  }
  if ((o.name ?? '') !== (n.name ?? '')) {
    out.push({ field: 'Navn', from: o.name || '—', to: n.name || '—' })
  }
  if (o.phase_type_id !== n.phase_type_id) {
    out.push({
      field: 'Fasetype',
      from: r?.phaseTypeName?.(o.phase_type_id) ?? o.phase_type_id,
      to: r?.phaseTypeName?.(n.phase_type_id) ?? n.phase_type_id,
    })
  }
  return out
}

function diffMilestone(o: GanttMilestone, n: GanttMilestone): FieldChange[] {
  const out: FieldChange[] = []
  if (o.start_date !== n.start_date || (o.end_date ?? '') !== (n.end_date ?? '')) {
    out.push({ field: 'Periode', from: period(o.start_date, o.end_date), to: period(n.start_date, n.end_date) })
  }
  if ((o.title ?? '') !== (n.title ?? '')) out.push({ field: 'Navn', from: o.title || '—', to: n.title || '—' })
  return out
}

/** Diff to snapshots: lagt til / fjernet / endret, for faser og milepæler. */
export function diffSnapshots(
  oldSnap: ProjectPhaseSnapshot | null | undefined,
  newSnap: ProjectPhaseSnapshot | null | undefined,
  r?: DiffResolvers,
): SnapshotDiff {
  const oldPhases = oldSnap?.phases ?? []
  const newPhases = newSnap?.phases ?? []
  const oldMap = new Map(oldPhases.map((p) => [p.id, p]))
  const newMap = new Map(newPhases.map((p) => [p.id, p]))

  const phases: ItemChange[] = []
  for (const np of newPhases) {
    const op = oldMap.get(np.id)
    if (!op) phases.push({ id: np.id, label: phaseLabel(np, r), kind: 'added', fields: [] })
    else {
      const fields = diffPhase(op, np, r)
      if (fields.length) phases.push({ id: np.id, label: phaseLabel(np, r), kind: 'changed', fields })
    }
  }
  for (const op of oldPhases) {
    if (!newMap.has(op.id)) phases.push({ id: op.id, label: phaseLabel(op, r), kind: 'removed', fields: [] })
  }

  const oldMs = oldSnap?.milestones ?? []
  const newMs = newSnap?.milestones ?? []
  const oldMsMap = new Map(oldMs.map((m) => [m.id, m]))
  const newMsMap = new Map(newMs.map((m) => [m.id, m]))
  const milestones: ItemChange[] = []
  for (const nm of newMs) {
    const om = oldMsMap.get(nm.id)
    if (!om) milestones.push({ id: nm.id, label: nm.title || 'Milepæl', kind: 'added', fields: [] })
    else {
      const fields = diffMilestone(om, nm)
      if (fields.length) milestones.push({ id: nm.id, label: nm.title || 'Milepæl', kind: 'changed', fields })
    }
  }
  for (const om of oldMs) {
    if (!newMsMap.has(om.id)) milestones.push({ id: om.id, label: om.title || 'Milepæl', kind: 'removed', fields: [] })
  }

  return { phases, milestones, total: phases.length + milestones.length }
}
