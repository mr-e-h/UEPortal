'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { useMe } from '@/lib/useMe'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { PhaseType, ProjectPhase } from '@/components/admin/FremdriftsplanClient'
import type { GanttMilestone } from '@/types'

const STATUS_LABEL: Record<ProjectPhase['status'], string> = {
  planned: 'Planlagt',
  in_progress: 'Pågår',
  done: 'Ferdig',
}
const STATUS_CLS: Record<ProjectPhase['status'], string> = {
  planned: 'bg-muted text-[var(--color-text-muted)]',
  in_progress: 'bg-primary-soft text-primary',
  done: 'bg-success-soft text-success',
}

type Draft = {
  phase_type_id: string
  name: string
  start_date: string
  end_date: string
  status: ProjectPhase['status']
  progress_percent: string
}
const emptyDraft = (typeId = ''): Draft => ({
  phase_type_id: typeId, name: '', start_date: '', end_date: '', status: 'planned', progress_percent: '0',
})

/**
 * Arbeidsfaser-CRUD på prosjektets Fremdriftsplan-fane. Fasene er de typede
 * radene porteføljevisningen /admin/fremdriftsplan filtrerer på (Graving,
 * Luftarbeid, ...). Ingen økonomi her — trygt for byggeleder, som dog kun kan
 * endre status/fremdrift (API-et håndhever det; UI-et speiler det).
 * Tåler at 0002 ikke er kjørt: fasetyper = [] → viser aktiveringshint.
 */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

export default function PhasesSection({
  projectId,
  onChanged,
  milestones = [],
  onMilestonesChanged,
}: {
  projectId: string
  onChanged?: () => void
  /** Legacy-milepæler — vises og redigeres i SAMME tabell som fasene
      (én fremdriftsplan, ikke to). Nye elementer opprettes som faser. */
  milestones?: GanttMilestone[]
  onMilestonesChanged?: () => Promise<void> | void
}) {
  const { me } = useMe()
  const canManage = !!me && ['main', 'company', 'project_manager'].includes(me.role)
  const canTouchStatus = canManage || me?.role === 'byggeleder'

  const [types, setTypes] = useState<PhaseType[]>([])
  const [phases, setPhases] = useState<ProjectPhase[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft())
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Milepæl-rader (legacy-modellen) i samme tabell: egen redigeringstilstand
  // siden feltene er færre (navn + datoer) og API-et er et annet.
  const [msEditingId, setMsEditingId] = useState<string | null>(null)
  const [msDraft, setMsDraft] = useState({ title: '', start_date: '', end_date: '' })
  const [msConfirmDeleteId, setMsConfirmDeleteId] = useState<string | null>(null)

  async function submitMsEdit(id: string) {
    setSaving(true); setError('')
    const res = await fetch('/api/milestones', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title: msDraft.title, start_date: msDraft.start_date, end_date: msDraft.end_date || msDraft.start_date }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError((d as { error?: string }).error ?? 'Lagring feilet')
      return
    }
    setMsEditingId(null)
    await onMilestonesChanged?.()
    onChanged?.()
  }

  async function doMsDelete(id: string) {
    setMsConfirmDeleteId(null)
    const res = await fetch(`/api/milestones?id=${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setError('Sletting feilet')
      return
    }
    await onMilestonesChanged?.()
    onChanged?.()
  }

  const refresh = useCallback(async () => {
    const [t, p] = await Promise.all([
      fetch('/api/phase-types').then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/project-phases?project_id=${projectId}`).then((r) => (r.ok ? r.json() : [])),
    ])
    setTypes(Array.isArray(t) ? t : [])
    setPhases(Array.isArray(p) ? p : [])
    setLoaded(true)
    // Varsle forelderen (samlet tidslinje på fanen leser samme data).
    onChanged?.()
  }, [projectId, onChanged])

  useEffect(() => { refresh() }, [refresh])

  const typeById = new Map(types.map((t) => [t.id, t]))

  // Oppretter standardfasene (prosjekttypens mal, ellers alle aktive
  // fasetyper). Additiv — typer som allerede har fase hoppes over server-side.
  async function applyStandard() {
    setSaving(true); setError('')
    const res = await fetch('/api/project-phases/apply-standard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError((d as { error?: string }).error ?? 'Kunne ikke legge til standardfaser')
      return
    }
    refresh()
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    const res = await fetch('/api/project-phases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        phase_type_id: draft.phase_type_id,
        name: draft.name || null,
        start_date: draft.start_date,
        end_date: draft.end_date || null,
        status: draft.status,
        progress_percent: Number(draft.progress_percent) || 0,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError((d as { error?: string }).error ?? 'Lagring feilet')
      return
    }
    setDraft(emptyDraft(types[0]?.id))
    setShowAdd(false)
    refresh()
  }

  function startEdit(p: ProjectPhase) {
    setEditingId(p.id)
    setEditDraft({
      phase_type_id: p.phase_type_id,
      name: p.name ?? '',
      start_date: p.start_date,
      end_date: p.end_date ?? '',
      status: p.status,
      progress_percent: String(p.progress_percent),
    })
  }

  async function submitEdit(id: string) {
    setSaving(true); setError('')
    // Byggeleder sender kun status/progress — API-et avviser ellers.
    const body = canManage
      ? {
          phase_type_id: editDraft.phase_type_id,
          name: editDraft.name || null,
          start_date: editDraft.start_date,
          end_date: editDraft.end_date || null,
          status: editDraft.status,
          progress_percent: Number(editDraft.progress_percent) || 0,
        }
      : { status: editDraft.status, progress_percent: Number(editDraft.progress_percent) || 0 }
    const res = await fetch(`/api/project-phases/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError((d as { error?: string }).error ?? 'Lagring feilet')
      return
    }
    setEditingId(null)
    refresh()
  }

  async function doDelete(id: string) {
    await fetch(`/api/project-phases/${id}`, { method: 'DELETE' })
    setConfirmDeleteId(null)
    refresh()
  }

  if (!loaded) return null

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900">Arbeidsfaser</h2>
        {canManage && types.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={applyStandard}
              disabled={saving}
              title="Oppretter standardfasene for prosjekttypen (eller alle fasetyper). Typer som allerede har fase hoppes over."
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card text-[var(--color-text-secondary)] hover:bg-muted disabled:opacity-50"
            >
              Legg til standardfaser
            </button>
            <button
              type="button"
              onClick={() => { setDraft(emptyDraft(types[0]?.id)); setShowAdd((v) => !v) }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card text-[var(--color-text-secondary)] hover:bg-muted"
            >
              {showAdd ? <X size={13} /> : <Plus size={13} />} {showAdd ? 'Avbryt' : 'Legg til fase'}
            </button>
          </div>
        )}
      </div>

      {types.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)] bg-warning-soft border border-amber-200 rounded-lg px-3 py-2">
          Arbeidsfaser er ikke tilgjengelig ennå.
        </p>
      ) : (
        <>
          {error && <p className="text-sm text-danger mb-2">{error}</p>}

          {showAdd && canManage && (
            <form onSubmit={submitAdd} className="bg-primary-soft/40 border border-border rounded-lg p-3 mb-3 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
              <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">Fase
                <select required value={draft.phase_type_id} onChange={(e) => setDraft((d) => ({ ...d, phase_type_id: e.target.value }))} className="px-2 py-1.5 text-sm border border-border rounded bg-white">
                  <option value="">Velg…</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">Navn (valgfritt)
                <input type="text" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="F.eks. Etappe 2" className="px-2 py-1.5 text-sm border border-border rounded bg-white" />
              </label>
              <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">Start
                <input required type="date" value={draft.start_date} onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value }))} className="px-2 py-1.5 text-sm border border-border rounded bg-white" />
              </label>
              <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">Slutt
                <input type="date" value={draft.end_date} onChange={(e) => setDraft((d) => ({ ...d, end_date: e.target.value }))} className="px-2 py-1.5 text-sm border border-border rounded bg-white" />
              </label>
              <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">Status
                <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as ProjectPhase['status'] }))} className="px-2 py-1.5 text-sm border border-border rounded bg-white">
                  {(['planned', 'in_progress', 'done'] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
              <button type="submit" disabled={saving} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50">
                {saving ? 'Lagrer…' : 'Lagre fase'}
              </button>
            </form>
          )}

          {phases.length === 0 && milestones.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] py-2">
              Ingen arbeidsfaser registrert{canManage ? ' — legg til den første.' : '.'}
            </p>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-2.5">Fase</th>
                    <th className="px-4 py-2.5">Periode</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Fremdrift</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {/* Milepæler (legacy) i samme tabell — én plan, ikke to. */}
                  {[...milestones].sort((a, b) => a.start_date.localeCompare(b.start_date)).map((m) => {
                    const isMsEditing = msEditingId === m.id
                    return (
                      <tr key={`ms-${m.id}`} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-2.5">
                          {isMsEditing && canManage ? (
                            <input
                              type="text"
                              value={msDraft.title}
                              onChange={(e) => setMsDraft((d) => ({ ...d, title: e.target.value }))}
                              className="px-2 py-1 text-sm border border-primary rounded w-44"
                            />
                          ) : (
                            <span className="inline-flex items-center gap-2 font-medium text-gray-900">
                              <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ backgroundColor: m.color || '#94A3B8' }} />
                              {m.title}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--color-text-secondary)] whitespace-nowrap">
                          {isMsEditing && canManage ? (
                            <span className="inline-flex gap-1">
                              <input type="date" value={msDraft.start_date} onChange={(e) => setMsDraft((d) => ({ ...d, start_date: e.target.value }))} className="px-1.5 py-1 text-xs border border-primary rounded" />
                              <input type="date" value={msDraft.end_date} onChange={(e) => setMsDraft((d) => ({ ...d, end_date: e.target.value }))} className="px-1.5 py-1 text-xs border border-primary rounded" />
                            </span>
                          ) : (
                            <>{fmtDate(m.start_date)} – {fmtDate(m.end_date)}</>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-[var(--color-text-muted)]">Milepæl</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--color-text-secondary)]">–</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {isMsEditing ? (
                              <>
                                <button onClick={() => submitMsEdit(m.id)} disabled={saving} title="Lagre" className="p-1 text-success hover:bg-success-soft rounded"><Check size={14} /></button>
                                <button onClick={() => setMsEditingId(null)} title="Avbryt" className="p-1 text-gray-400 hover:bg-muted rounded"><X size={14} /></button>
                              </>
                            ) : canManage ? (
                              <>
                                <button
                                  onClick={() => { setMsEditingId(m.id); setMsDraft({ title: m.title, start_date: m.start_date, end_date: m.end_date }) }}
                                  title="Rediger"
                                  className="p-1 text-gray-400 hover:text-primary hover:bg-primary-soft rounded"
                                ><Pencil size={14} /></button>
                                <button onClick={() => setMsConfirmDeleteId(m.id)} title="Slett" className="p-1 text-gray-400 hover:text-danger hover:bg-danger-soft rounded"><Trash2 size={14} /></button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {phases.map((p) => {
                    const t = typeById.get(p.phase_type_id)
                    const isEditing = editingId === p.id
                    return (
                      <tr key={p.id} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-2.5">
                          {isEditing && canManage ? (
                            <select value={editDraft.phase_type_id} onChange={(e) => setEditDraft((d) => ({ ...d, phase_type_id: e.target.value }))} className="px-2 py-1 text-sm border border-primary rounded">
                              {types.map((tt) => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
                            </select>
                          ) : (
                            <span className="inline-flex items-center gap-2 font-medium text-gray-900">
                              <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ backgroundColor: t?.color ?? '#94A3B8' }} />
                              {p.name || t?.name || '–'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--color-text-secondary)] whitespace-nowrap">
                          {isEditing && canManage ? (
                            <span className="inline-flex gap-1">
                              <input type="date" value={editDraft.start_date} onChange={(e) => setEditDraft((d) => ({ ...d, start_date: e.target.value }))} className="px-1.5 py-1 text-xs border border-primary rounded" />
                              <input type="date" value={editDraft.end_date} onChange={(e) => setEditDraft((d) => ({ ...d, end_date: e.target.value }))} className="px-1.5 py-1 text-xs border border-primary rounded" />
                            </span>
                          ) : (
                            <>{fmtDate(p.start_date)} – {p.end_date ? fmtDate(p.end_date) : 'pågående'}</>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {isEditing ? (
                            <select value={editDraft.status} onChange={(e) => setEditDraft((d) => ({ ...d, status: e.target.value as ProjectPhase['status'] }))} className="px-2 py-1 text-sm border border-primary rounded">
                              {(['planned', 'in_progress', 'done'] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                            </select>
                          ) : (
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLS[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {isEditing ? (
                            <input type="number" min={0} max={100} value={editDraft.progress_percent} onChange={(e) => setEditDraft((d) => ({ ...d, progress_percent: e.target.value }))} className="w-16 px-1.5 py-1 text-sm text-right border border-primary rounded" />
                          ) : (
                            <span className="text-[var(--color-text-secondary)]">{p.progress_percent > 0 ? `${p.progress_percent}%` : '–'}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {isEditing ? (
                              <>
                                <button onClick={() => submitEdit(p.id)} disabled={saving} title="Lagre" className="p-1 text-success hover:bg-success-soft rounded"><Check size={14} /></button>
                                <button onClick={() => setEditingId(null)} title="Avbryt" className="p-1 text-gray-400 hover:bg-muted rounded"><X size={14} /></button>
                              </>
                            ) : (
                              <>
                                {canTouchStatus && (
                                  <button onClick={() => startEdit(p)} title={canManage ? 'Rediger' : 'Oppdater status/fremdrift'} className="p-1 text-gray-400 hover:text-primary hover:bg-primary-soft rounded"><Pencil size={14} /></button>
                                )}
                                {canManage && (
                                  <button onClick={() => setConfirmDeleteId(p.id)} title="Slett fase" className="p-1 text-gray-400 hover:text-danger hover:bg-danger-soft rounded"><Trash2 size={14} /></button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Slett arbeidsfase?"
          message="Fasen fjernes fra fremdriftsplanen. Dette kan ikke angres."
          confirmLabel="Slett"
          onConfirm={() => doDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
      {msConfirmDeleteId && (
        <ConfirmDialog
          title="Slett milepæl?"
          message="Milepælen fjernes fra fremdriftsplanen. Dette kan ikke angres."
          confirmLabel="Slett"
          onConfirm={() => doMsDelete(msConfirmDeleteId)}
          onCancel={() => setMsConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
