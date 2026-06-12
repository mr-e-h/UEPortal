'use client'

import { useState, useEffect, useRef } from 'react'
import type { GanttMilestone, Subcontractor } from '@/types'
import { Plus, Trash2, X, Check, GripVertical, ChevronRight, Pencil } from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { MILESTONE_COLORS as COLORS, DEFAULT_MILESTONE_COLOR } from '@/lib/milestone-colors'

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

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: '2-digit' })
}

const BLANK_FORM = { title: '', start_date: '', end_date: '', color: DEFAULT_MILESTONE_COLOR, subcontractor_id: '' }
type RowForm = typeof BLANK_FORM

interface Props {
  projectId: string
  projectStart: string
  projectEnd: string
  milestones: GanttMilestone[]
  allSubs: Subcontractor[]
  projectSubs: string[]
  onRefresh: () => void
}

type TooltipState = { id: string; x: number; y: number } | null

export default function GanttSection({ projectId, projectStart, projectEnd, milestones, allSubs, projectSubs, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Global edit mode
  const [isEditMode, setIsEditMode] = useState(false)
  const [pendingEdits, setPendingEdits] = useState<Record<string, RowForm>>({})
  const [savingEdits, setSavingEdits] = useState(false)

  // Ordered list
  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const dragIndex = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  useEffect(() => {
    const sorted = [...milestones].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    setOrderedIds((prev) => {
      const kept = prev.filter((id) => milestones.some((m) => m.id === id))
      const added = sorted.map((m) => m.id).filter((id) => !kept.includes(id))
      return [...kept, ...added]
    })
  }, [milestones])

  const orderedMilestones = orderedIds
    .map((id) => milestones.find((m) => m.id === id))
    .filter((m): m is GanttMilestone => !!m)

  const subOptions = allSubs.filter((s) => projectSubs.includes(s.id))
  const today = new Date().toISOString().split('T')[0]

  const displayStart = (() => { const d = new Date(projectStart); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0] })()
  const displayEnd = (() => { const d = new Date(projectEnd); d.setMonth(d.getMonth() + 1); return d.toISOString().split('T')[0] })()
  const monthHeaders = buildMonthHeaders(displayStart, displayEnd)

  // ─── Add new milestone ───────────────────────────────────────────────────────
  async function handleSave() {
    if (!form.title || !form.start_date || !form.end_date) return
    setSaving(true)
    await fetch('/api/milestones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        title: form.title,
        start_date: form.start_date,
        end_date: form.end_date,
        color: form.color,
        subcontractor_id: form.subcontractor_id || null,
        sort_order: milestones.length,
      }),
    })
    setSaving(false)
    setForm(BLANK_FORM)
    setShowForm(false)
    onRefresh()
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    setDeletingId(id)
    setConfirmDeleteId(null)
    await fetch(`/api/milestones?id=${id}`, { method: 'DELETE' })
    setDeletingId(null)
    onRefresh()
  }

  // ─── Global edit mode ────────────────────────────────────────────────────────
  function enterEditMode() {
    const initial: Record<string, RowForm> = {}
    for (const m of orderedMilestones) {
      initial[m.id] = {
        title: m.title,
        start_date: m.start_date,
        end_date: m.end_date,
        color: m.color,
        subcontractor_id: m.subcontractor_id ?? '',
      }
    }
    setPendingEdits(initial)
    setIsEditMode(true)
    setExpandedId(null)
  }

  function exitEditMode() {
    setIsEditMode(false)
    setPendingEdits({})
  }

  function updateEdit(id: string, key: keyof RowForm, value: string) {
    setPendingEdits((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }))
  }

  const dirtyCount = orderedMilestones.filter((m) => {
    const e = pendingEdits[m.id]
    if (!e) return false
    return e.title !== m.title || e.start_date !== m.start_date || e.end_date !== m.end_date ||
      e.color !== m.color || (e.subcontractor_id || null) !== m.subcontractor_id
  }).length

  async function saveAllEdits() {
    setSavingEdits(true)
    const changed = orderedMilestones.filter((m) => {
      const e = pendingEdits[m.id]
      if (!e) return false
      return e.title !== m.title || e.start_date !== m.start_date || e.end_date !== m.end_date ||
        e.color !== m.color || (e.subcontractor_id || null) !== m.subcontractor_id
    })
    await Promise.all(changed.map((m) => {
      const e = pendingEdits[m.id]
      return fetch('/api/milestones', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: m.id,
          title: e.title,
          start_date: e.start_date,
          end_date: e.end_date,
          color: e.color,
          subcontractor_id: e.subcontractor_id || null,
        }),
      })
    }))
    setSavingEdits(false)
    setIsEditMode(false)
    setPendingEdits({})
    onRefresh()
  }

  // ─── Drag & drop ─────────────────────────────────────────────────────────────
  function handleDragStart(index: number) { dragIndex.current = index }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (dragIndex.current !== null && dragIndex.current !== index) setDragOverIndex(index)
  }
  function handleDrop(index: number) {
    const from = dragIndex.current
    if (from === null || from === index) { dragIndex.current = null; setDragOverIndex(null); return }
    const next = [...orderedIds]
    const [moved] = next.splice(from, 1)
    next.splice(index, 0, moved)
    setOrderedIds(next)
    dragIndex.current = null
    setDragOverIndex(null)
    fetch('/api/milestones', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next.map((id, i) => ({ id, sort_order: i }))),
    })
  }
  function handleDragEnd() { dragIndex.current = null; setDragOverIndex(null) }

  const tooltipMilestone = tooltip ? milestones.find((m) => m.id === tooltip.id) : null
  const tooltipSub = tooltipMilestone ? allSubs.find((s) => s.id === tooltipMilestone.subcontractor_id) : null
  const colWidth = isEditMode ? 'w-64' : 'w-48'

  return (
    <section>
      {tooltipMilestone && tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl max-w-[220px]"
          style={{ left: tooltip.x + 14, top: tooltip.y - 12 }}
        >
          <div className="font-semibold leading-snug">{tooltipMilestone.title}</div>
          <div className="text-gray-300 mt-1">
            {formatDate(tooltipMilestone.start_date)}
            {tooltipMilestone.start_date !== tooltipMilestone.end_date && ` – ${formatDate(tooltipMilestone.end_date)}`}
          </div>
          {tooltipSub && <div className="text-gray-400 mt-0.5">{tooltipSub.company_name}</div>}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        {/* «Milepæler», ikke «Fremdriftsplan» — den samlede planen (faser +
            milepæler) rendres øverst på fanen; dette er milepæl-editoren. */}
        <h2 className="text-lg font-semibold text-gray-900">Milepæler</h2>
        <div className="flex items-center gap-2">
          {isEditMode ? (
            <>
              <span className="text-xs text-gray-400">
                {dirtyCount > 0 ? `${dirtyCount} endring${dirtyCount !== 1 ? 'er' : ''}` : 'Ingen endringer'}
              </span>
              <button
                onClick={exitEditMode}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Avbryt
              </button>
              <button
                onClick={saveAllEdits}
                disabled={savingEdits || dirtyCount === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                <Check size={12} />
                {savingEdits ? 'Lagrer...' : 'Lagre endringer'}
              </button>
            </>
          ) : (
            <>
              {orderedMilestones.length > 0 && (
                <button
                  onClick={enterEditMode}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <Pencil size={12} />
                  Rediger
                </button>
              )}
              <button
                onClick={() => setShowForm((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus size={13} />
                Ny milepæl
              </button>
            </>
          )}
        </div>
      </div>

      {/* Add form */}
      {showForm && !isEditMode && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">Legg til milepæl / oppgave</span>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Tittel</label>
              <input type="text" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="f.eks. Kabling sone A" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Startdato</label>
              <input type="date" value={form.start_date} min={projectStart} max={projectEnd} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Sluttdato</label>
              <input type="date" value={form.end_date} min={form.start_date || projectStart} max={projectEnd} onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Underentreprenør (valgfritt)</label>
              <select value={form.subcontractor_id} onChange={(e) => setForm((p) => ({ ...p, subcontractor_id: e.target.value }))} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">— Ingen UE —</option>
                {subOptions.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Farge</label>
              <div className="flex gap-1.5 flex-wrap">
                {COLORS.map((c) => (
                  <button key={c.value} title={c.label} onClick={() => setForm((p) => ({ ...p, color: c.value }))} className={`w-6 h-6 rounded-full border-2 transition-transform ${form.color === c.value ? 'border-gray-900 scale-110' : 'border-transparent'}`} style={{ backgroundColor: c.value }} />
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Avbryt</button>
            <button onClick={handleSave} disabled={saving || !form.title || !form.start_date || !form.end_date} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40">
              {saving ? 'Lagrer...' : 'Lagre'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {orderedMilestones.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            Ingen milepæler lagt til ennå. Klikk «Ny milepæl» for å starte.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              {/* Header */}
              <div className="flex border-b border-gray-200">
                <div className={`${colWidth} flex-none px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider border-r border-gray-100`}>
                  Oppgave
                </div>
                <div className="flex-1 relative h-10 bg-gray-50">
                  {monthHeaders.map((h, i) => (
                    <div key={i} className="absolute top-0 h-full flex items-center px-1 border-r border-gray-100 text-[10px] text-gray-400 overflow-hidden" style={{ left: `${h.leftPct}%`, width: `${h.widthPct}%` }}>
                      {h.label}
                    </div>
                  ))}
                  {today >= displayStart && today <= displayEnd && (
                    <div className="absolute top-0 h-full w-px bg-red-400 opacity-70" style={{ left: `${pct(today, displayStart, displayEnd)}%` }} />
                  )}
                </div>
              </div>

              {/* Rows */}
              {orderedMilestones.map((m, index) => {
                const isDragTarget = dragOverIndex === index
                const isExpanded = expandedId === m.id
                const edit = pendingEdits[m.id] ?? { title: m.title, start_date: m.start_date, end_date: m.end_date, color: m.color, subcontractor_id: m.subcontractor_id ?? '' }
                const isDirty = isEditMode && (
                  edit.title !== m.title || edit.start_date !== m.start_date || edit.end_date !== m.end_date ||
                  edit.color !== m.color || (edit.subcontractor_id || null) !== m.subcontractor_id
                )

                // Use pending edit values for the Gantt bar when in edit mode
                const displayStart_ = isEditMode ? (edit.start_date || m.start_date) : m.start_date
                const displayEnd_ = isEditMode ? (edit.end_date || m.end_date) : m.end_date
                const displayColor = isEditMode ? edit.color : m.color
                const leftPct = pct(displayStart_, displayStart, displayEnd)
                const rightPct = pct(displayEnd_, displayStart, displayEnd)
                const widthPct = Math.max(rightPct - leftPct, 0.5)
                const isSingleDay = displayStart_ === displayEnd_
                const sub = allSubs.find((s) => s.id === (isEditMode ? (edit.subcontractor_id || null) : m.subcontractor_id))

                return (
                  <div
                    key={m.id}
                    draggable={!isEditMode}
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={() => handleDrop(index)}
                    onDragEnd={handleDragEnd}
                    className={`flex border-b border-gray-50 group transition-colors ${
                      isDragTarget ? 'bg-blue-50 border-t-2 border-t-blue-400' :
                      isDirty ? 'bg-amber-50/40' :
                      isEditMode ? 'hover:bg-gray-50/50' :
                      'hover:bg-gray-50'
                    }`}
                  >
                    {/* Left panel */}
                    <div className={`${colWidth} flex-none border-r border-gray-100 flex items-start gap-1 px-2 py-2.5`}>
                      <div className={`flex-none mt-0.5 shrink-0 text-gray-200 transition-colors ${isEditMode ? 'invisible' : 'cursor-grab active:cursor-grabbing hover:text-gray-400'}`}>
                        <GripVertical size={13} />
                      </div>

                      <div className="flex-1 min-w-0">
                        {isEditMode ? (
                          /* Edit mode — inline fields */
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1">
                              {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Endret" />}
                              <input
                                type="text"
                                value={edit.title}
                                onChange={(e) => updateEdit(m.id, 'title', e.target.value)}
                                className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-1">
                              <input type="date" value={edit.start_date} min={projectStart} max={projectEnd} onChange={(e) => updateEdit(m.id, 'start_date', e.target.value)} className="w-full border border-gray-300 rounded px-1 py-0.5 text-[10px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                              <input type="date" value={edit.end_date} min={edit.start_date || projectStart} max={projectEnd} onChange={(e) => updateEdit(m.id, 'end_date', e.target.value)} className="w-full border border-gray-300 rounded px-1 py-0.5 text-[10px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                            </div>
                            <select value={edit.subcontractor_id} onChange={(e) => updateEdit(m.id, 'subcontractor_id', e.target.value)} className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-[10px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500">
                              <option value="">— Ingen UE —</option>
                              {subOptions.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
                            </select>
                            <div className="flex gap-1 flex-wrap">
                              {COLORS.map((c) => (
                                <button key={c.value} title={c.label} onClick={() => updateEdit(m.id, 'color', c.value)} className={`w-4 h-4 rounded-full border-2 transition-transform ${edit.color === c.value ? 'border-gray-900 scale-110' : 'border-transparent'}`} style={{ backgroundColor: c.value }} />
                              ))}
                            </div>
                            <button
                              onClick={() => setConfirmDeleteId(m.id)}
                              disabled={deletingId === m.id}
                              className="flex items-center gap-1 text-[10px] text-gray-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={10} /> Slett
                            </button>
                          </div>
                        ) : (
                          /* Read mode — compact with click-to-expand */
                          <div>
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : m.id)}
                              className="w-full text-left flex items-center gap-1.5"
                            >
                              <span className="w-2 h-2 rounded-full flex-none shrink-0" style={{ backgroundColor: m.color }} />
                              <span className="text-xs font-medium text-gray-800 truncate flex-1" title={m.title}>{m.title}</span>
                              <span className={`text-gray-300 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                                <ChevronRight size={11} />
                              </span>
                            </button>
                            {isExpanded && (
                              <div className="mt-1.5 pl-3.5 space-y-1">
                                {sub && <div className="text-[10px] text-gray-500 truncate">{sub.company_name}</div>}
                                <div className="text-[10px] text-gray-400">
                                  {formatDate(m.start_date)}{m.start_date !== m.end_date && ` – ${formatDate(m.end_date)}`}
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(m.id) }}
                                  disabled={deletingId === m.id}
                                  className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-red-500"
                                >
                                  <Trash2 size={10} /> Slett
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Gantt bar — live-updates from pendingEdits in edit mode */}
                    <div className="flex-1 relative py-4">
                      {monthHeaders.map((h, i) => (
                        <div key={i} className="absolute top-0 h-full border-r border-gray-50" style={{ left: `${h.leftPct + h.widthPct}%` }} />
                      ))}
                      {today >= displayStart && today <= displayEnd && (
                        <div className="absolute top-0 h-full w-px bg-red-300 opacity-60" style={{ left: `${pct(today, displayStart, displayEnd)}%` }} />
                      )}
                      {isSingleDay ? (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rotate-45 cursor-pointer"
                          style={{ left: `${leftPct}%`, backgroundColor: displayColor }}
                          onMouseEnter={isEditMode ? undefined : (e) => setTooltip({ id: m.id, x: e.clientX, y: e.clientY })}
                          onMouseMove={isEditMode ? undefined : (e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : t)}
                          onMouseLeave={isEditMode ? undefined : () => setTooltip(null)}
                        />
                      ) : (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 h-7 rounded cursor-pointer"
                          style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: displayColor, opacity: 0.85 }}
                          onMouseEnter={isEditMode ? undefined : (e) => setTooltip({ id: m.id, x: e.clientX, y: e.clientY })}
                          onMouseMove={isEditMode ? undefined : (e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : t)}
                          onMouseLeave={isEditMode ? undefined : () => setTooltip(null)}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sticky save bar when editing with changes */}
      {isEditMode && dirtyCount > 0 && (
        <div className="mt-3 flex items-center justify-between px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-xs text-amber-700 font-medium">
            {dirtyCount} milepæl{dirtyCount !== 1 ? 'er' : ''} endret — husker å lagre!
          </span>
          <div className="flex gap-2">
            <button onClick={exitEditMode} className="px-3 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50">Avbryt</button>
            <button onClick={saveAllEdits} disabled={savingEdits} className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50">
              <Check size={11} />{savingEdits ? 'Lagrer...' : 'Lagre endringer'}
            </button>
          </div>
        </div>
      )}
      {confirmDeleteId && (
        <ConfirmDialog
          title="Slett milepæl?"
          message="Milepælen slettes permanent."
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
