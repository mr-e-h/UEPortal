'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Plus, Trash2, ChevronDown, ChevronRight, ChevronLeft, Save, Pencil, Check, X, GripVertical, Heading2 } from 'lucide-react'
import type { PhaseType } from '@/components/admin/FremdriftsplanClient'
import Card from '@/components/ui/Card'
import Field from '@/components/ui/Field'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import ErrorBox from '@/components/ui/ErrorBox'
import EmptyState from '@/components/ui/EmptyState'
import { useConfirm } from '@/components/ui/useConfirm'
import ProjectTypeImportConfig from './ProjectTypeImportConfig'
import { api, apiErrorMessage } from '@/lib/api'
import type { ProjectType, ProjectTypeChecklistItem } from '@/types'

type TypeWithItems = ProjectType & { items: ProjectTypeChecklistItem[] }

/**
 * Admin registry for project types and their checklist templates.
 *
 * Each type renders as an expandable card. Inside, the admin can:
 *   - rename / re-describe the type
 *   - add new template items (label only)
 *   - tick items as "done" — wait, no, this is the TEMPLATE; ticking
 *     happens per-project. Here we only manage the template list.
 *   - reorder by drag (not yet — for now sort_order is set on add)
 *   - delete the whole type
 *
 * When the type is later assigned to a project, the items are copied
 * into the per-project checklist instance via
 * POST /api/projects/[id]/checklist.
 */
export default function ProjectTypesPage() {
  const [types, setTypes] = useState<TypeWithItems[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { confirm: confirmAction, confirmDialog } = useConfirm()

  const refresh = useCallback(async () => {
    const res = await fetch('/api/project-types')
    const data = await res.json().catch(() => [])
    if (Array.isArray(data)) setTypes(data as TypeWithItems[])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function addType(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setAdding(true)
    const res = await fetch('/api/project-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, description: newDesc }),
    })
    setAdding(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Lagring feilet')
      return
    }
    setNewName(''); setNewDesc('')
    refresh()
  }

  async function deleteType(t: TypeWithItems) {
    if (!(await confirmAction({
      title: 'Slett typen?',
      message: `«${t.name}» slettes. Sjekklister på eksisterende prosjekter beholdes, men typen kobles fra.`,
      confirmLabel: 'Slett',
    }))) return
    const res = await fetch(`/api/project-types/${t.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Sletting feilet')
      return
    }
    setTypes((prev) => prev.filter((x) => x.id !== t.id))
  }

  async function renameType(t: TypeWithItems, name: string) {
    const res = await fetch(`/api/project-types/${t.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Lagring feilet')
      return
    }
    refresh()
  }

  if (loading) return <div className="p-6 text-sm text-[var(--color-text-muted)]">Laster...</div>

  return (
    <div className="p-6 space-y-6">
      {confirmDialog}
      <Link href="/admin/innstillinger" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-primary">
        <ChevronLeft size={14} /> Innstillinger
      </Link>
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Type prosjekt</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
          Definer kategorier av prosjekter og standard sjekklister som genereres automatisk.
        </p>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">Legg til ny type</h2>
        {error && <ErrorBox className="mb-3">{error}</ErrorBox>}
        <form onSubmit={addType} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Navn">
            <Input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="F.eks. Fiber FTTH"
            />
          </Field>
          <Field label="Beskrivelse (valgfri)" className="sm:col-span-2">
            <Input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Kort beskrivelse"
            />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={adding || !newName.trim()}>
              <Plus size={14} className="mr-1" /> Legg til
            </Button>
          </div>
        </form>
      </Card>

      {types.length === 0 ? (
        <Card>
          <EmptyState
            title="Ingen prosjekttyper enda"
            description="Opprett din første type over for å starte sjekkliste-bibliotek."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {types.map((t) => (
            <TypeCard
              key={t.id}
              type={t}
              isExpanded={expanded === t.id}
              onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
              onDelete={() => deleteType(t)}
              onRename={(n) => renameType(t, n)}
              onChange={refresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface TypeCardProps {
  type: TypeWithItems
  isExpanded: boolean
  onToggle: () => void
  onDelete: () => void
  onRename: (name: string) => void
  onChange: () => void
}

function TypeCard({ type, isExpanded, onToggle, onDelete, onRename, onChange }: TypeCardProps) {
  const [items, setItems] = useState<ProjectTypeChecklistItem[]>(type.items)
  const [dirty, setDirty] = useState(false)
  const [newItem, setNewItem] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Drag-and-drop for å endre rekkefølge (erstatter opp/ned-pilene).
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  useEffect(() => {
    setItems(type.items)
    setDirty(false)
  }, [type.items])

  function addItem(is_section: boolean) {
    if (!newItem.trim()) return
    setItems((prev) => [...prev, {
      id: `tmp_${Date.now()}`,
      project_type_id: type.id,
      label: newItem.trim(),
      sort_order: prev.length * 10,
      is_section,
      created_at: new Date().toISOString(),
    }])
    setNewItem('')
    setDirty(true)
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
    setDirty(true)
  }

  // Flytt en rad fra én posisjon til en annen (drag-and-drop).
  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return
    setItems((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setDirty(true)
  }

  function updateLabel(idx: number, label: string) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, label } : it)))
    setDirty(true)
  }

  async function save() {
    setSaving(true); setSaveError(null)
    const res = await fetch(`/api/project-types/${type.id}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map((i) => ({ label: i.label, is_section: i.is_section })) }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setSaveError(d.error ?? 'Lagring feilet')
      return
    }
    setDirty(false)
    onChange()
  }

  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(type.name)

  return (
    <Card className="overflow-hidden">
      <div
        className="px-5 py-3 flex items-center gap-3 cursor-pointer hover:bg-muted transition-colors"
        onClick={onToggle}
      >
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {renaming ? (
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              if (nameDraft.trim() && nameDraft !== type.name) onRename(nameDraft.trim())
              setRenaming(false)
            }}
            className="flex-1 flex gap-2"
          >
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => setRenaming(false)}
              className="flex-1 px-2 py-1 text-sm border border-border rounded bg-card"
            />
          </form>
        ) : (
          <div
            className="flex-1"
            onClick={(e) => { e.stopPropagation(); setNameDraft(type.name); setRenaming(true) }}
          >
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{type.name}</p>
            {type.description && (
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{type.description}</p>
            )}
          </div>
        )}
        <span className="text-xs text-[var(--color-text-muted)]">
          {(() => {
            const sectionCount = type.items.filter((i) => i.is_section).length
            const itemCount = type.items.length - sectionCount
            return sectionCount > 0
              ? `${itemCount} ${itemCount === 1 ? 'punkt' : 'punkter'} · ${sectionCount} ${sectionCount === 1 ? 'seksjon' : 'seksjoner'}`
              : `${itemCount} ${itemCount === 1 ? 'punkt' : 'punkter'}`
          })()}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="p-1 text-[var(--color-text-muted)] hover:text-red-600"
          title="Slett type"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-border px-5 py-4 space-y-3 bg-muted/30">
          {saveError && <ErrorBox>{saveError}</ErrorBox>}
          {items.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Ingen punkter ennå. Legg til under.</p>
          ) : (
            <ul className="space-y-1">
              {items.map((item, idx) => {
                const isDragging = dragIndex === idx
                const isDropTarget = overIndex === idx && dragIndex !== null && dragIndex !== idx
                const grip = (
                  <span
                    draggable
                    onDragStart={(e) => { setDragIndex(idx); e.dataTransfer.effectAllowed = 'move' }}
                    className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 text-[var(--color-text-muted)] hover:text-primary touch-none flex-none"
                    title="Dra for å endre rekkefølge"
                    aria-label="Dra for å endre rekkefølge"
                  >
                    <GripVertical size={14} />
                  </span>
                )
                const dropCls = `transition-colors ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'border-primary border-dashed bg-primary-soft' : 'border-border'}`
                const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overIndex !== idx) setOverIndex(idx) }
                const onDrop = (e: React.DragEvent) => { e.preventDefault(); if (dragIndex !== null) reorder(dragIndex, idx); setDragIndex(null); setOverIndex(null) }
                const onDragEnd = () => { setDragIndex(null); setOverIndex(null) }
                return item.is_section ? (
                  <li key={item.id} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} className={`flex items-center gap-2 bg-muted border rounded px-3 py-1.5 mt-2 first:mt-0 ${dropCls}`}>
                    {grip}
                    <Heading2 size={13} className="text-[var(--color-text-muted)] flex-none" />
                    <input
                      value={item.label}
                      onChange={(e) => updateLabel(idx, e.target.value)}
                      className="flex-1 text-sm font-semibold bg-transparent focus:outline-none text-[var(--color-text-primary)]"
                    />
                    <span className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide px-1.5 py-0.5 bg-border/60 rounded flex-none">
                      Seksjon
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="text-[var(--color-text-muted)] hover:text-red-600 flex-none"
                      title="Fjern seksjon"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ) : (
                  <li key={item.id} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} className={`flex items-center gap-2 bg-card border rounded px-3 py-1.5 pl-6 ${dropCls}`}>
                    {grip}
                    <span className="text-xs text-[var(--color-text-muted)] font-mono w-6">{idx + 1}.</span>
                    <input
                      value={item.label}
                      onChange={(e) => updateLabel(idx, e.target.value)}
                      className="flex-1 text-sm bg-transparent focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="text-[var(--color-text-muted)] hover:text-red-600 flex-none"
                      title="Fjern punkt"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <form
            className="flex gap-2 pt-2 flex-wrap"
            onSubmit={(e) => { e.preventDefault(); addItem(false) }}
          >
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Navn på punkt eller seksjon"
              className="flex-1 min-w-[180px] px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={!newItem.trim()}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-muted hover:bg-gray-200 text-[var(--color-text-primary)] rounded-lg font-medium disabled:opacity-50"
            >
              <Plus size={14} /> Punkt
            </button>
            <button
              type="button"
              onClick={() => addItem(true)}
              disabled={!newItem.trim()}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm border border-border bg-card hover:bg-muted text-[var(--color-text-secondary)] rounded-lg font-medium disabled:opacity-50"
            >
              <Heading2 size={14} /> Seksjon
            </button>
          </form>

          {dirty && (
            <div className="flex items-center gap-3 pt-2">
              <Button type="button" onClick={save} disabled={saving}>
                <Save size={14} className="mr-1" /> {saving ? 'Lagrer…' : 'Lagre endringer'}
              </Button>
              <span className="text-xs text-amber-700">Ulagrede endringer</span>
            </div>
          )}

          <DefaultPhasesEditor typeId={type.id} />
          <ProjectTypeImportConfig typeId={type.id} />
        </div>
      )}
    </Card>
  )
}

/**
 * Standardfaser-malen for prosjekttypen. Ingen mal lagret = alle aktive
 * fasetyper er standard (alt hukes av). «Legg til standardfaser» på
 * prosjektets fremdriftsplan bruker denne malen.
 */
function DefaultPhasesEditor({ typeId }: { typeId: string }) {
  const [phaseTypes, setPhaseTypes] = useState<PhaseType[]>([])
  // Fasene i denne typens standard rekkefølge (phase_type_id-er i rekkefølge).
  const [ordered, setOrdered] = useState<string[]>([])
  const [configured, setConfigured] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Ny fasetype (globalt register — blir tilgjengelig overalt).
  const [newPhaseName, setNewPhaseName] = useState('')
  const [newPhaseColor, setNewPhaseColor] = useState('#2563EB')
  const [addingPhase, setAddingPhase] = useState(false)

  // Rediger fasetype (navn/farge) — slår gjennom overalt der fasen vises.
  const [editPhaseId, setEditPhaseId] = useState<string | null>(null)
  const [editPhaseName, setEditPhaseName] = useState('')
  const [editPhaseColor, setEditPhaseColor] = useState('#2563EB')
  const [savingEdit, setSavingEdit] = useState(false)
  const { confirm: confirmAction, confirmDialog } = useConfirm()

  // Drag-and-drop-tilstand for å endre rekkefølge ved å dra fasene.
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  async function savePhaseEdit() {
    if (!editPhaseId || !editPhaseName.trim()) return
    setSavingEdit(true); setError('')
    let updated: PhaseType
    try {
      updated = await api.phaseTypes.update({ id: editPhaseId, name: editPhaseName.trim(), color: editPhaseColor })
    } catch (err) {
      setSavingEdit(false)
      setError(apiErrorMessage(err, 'Lagring feilet'))
      return
    }
    setSavingEdit(false)
    setPhaseTypes((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setEditPhaseId(null)
  }

  async function deletePhaseType(pt: PhaseType) {
    if (!(await confirmAction({
      title: 'Fjern fasen fra registeret?',
      message: `«${pt.name}» forsvinner fra fasevelgeren overalt. Faser som allerede ligger på prosjekter blokkerer sletting.`,
      confirmLabel: 'Fjern',
    }))) return
    setError('')
    try {
      await api.phaseTypes.remove(pt.id)
    } catch (err) {
      setError(apiErrorMessage(err, 'Sletting feilet'))
      return
    }
    setPhaseTypes((prev) => prev.filter((t) => t.id !== pt.id))
    setOrdered((prev) => prev.filter((x) => x !== pt.id))
  }

  async function addPhaseType() {
    const name = newPhaseName.trim()
    if (!name) return
    setAddingPhase(true); setError('')
    let created: PhaseType
    try {
      created = await api.phaseTypes.create({ name, color: newPhaseColor })
    } catch (err) {
      setAddingPhase(false)
      setError(apiErrorMessage(err, 'Kunne ikke opprette fasen'))
      return
    }
    setAddingPhase(false)
    setPhaseTypes((prev) => [...prev, created])
    // Ny fasetype legges i registeret. Uten egen rekkefølge er den automatisk
    // standard; har typen egen rekkefølge, legger du den til i lista når du vil.
    setNewPhaseName('')
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.phaseTypes.list().catch(() => []),
      api.defaultPhases.get(typeId).catch(() => ({ configured: false, phase_type_ids: [] })),
    ]).then(([pt, cfg]) => {
      if (cancelled) return
      const all = (Array.isArray(pt) ? pt : []) as PhaseType[]
      const active = all.filter((t) => t.is_active)
      setPhaseTypes(active)
      const c = cfg as { configured: boolean; phase_type_ids: string[] }
      setConfigured(c.configured)
      // Ingen egen rekkefølge = alle aktive fasetyper er standard (vist i
      // registerets rekkefølge, redigerbart).
      setOrdered(c.configured ? c.phase_type_ids : active.map((t) => t.id))
      setLoaded(true)
    }).catch(() => setLoaded(true))
    return () => { cancelled = true }
  }, [typeId])

  if (!loaded || phaseTypes.length === 0) return null

  const phaseById = new Map(phaseTypes.map((t) => [t.id, t]))
  const notInList = phaseTypes.filter((t) => !ordered.includes(t.id))

  // Flytt en fase fra én posisjon til en annen (drag-and-drop). `to` er
  // indeksen i den opprinnelige lista der fasen skal slippes.
  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return
    setOrdered((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setDirty(true)
  }
  function removeFromList(id: string) {
    setOrdered((prev) => prev.filter((x) => x !== id))
    setDirty(true)
  }
  function addToList(id: string) {
    setOrdered((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setDirty(true)
  }

  async function save() {
    setSaving(true); setError('')
    // Rekkefølgen lagres som den er. Tom liste = ingen egen rekkefølge →
    // «alle fasetyper er standard».
    try {
      await api.defaultPhases.save(typeId, ordered)
    } catch (err) {
      setSaving(false)
      setError(apiErrorMessage(err, 'Lagring feilet'))
      return
    }
    setSaving(false)
    setConfigured(ordered.length > 0)
    setDirty(false)
  }

  return (
    <div className="pt-3 border-t border-border space-y-2">
      {confirmDialog}
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-xs font-semibold text-[var(--color-text-primary)]">Standardfaser</h4>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {configured ? 'Egen rekkefølge — brukes ved «Legg til standardfaser»' : 'Alle fasetyper er standard (registerets rekkefølge)'}
        </span>
      </div>

      {/* Ordnet liste = standard rekkefølge for denne typen */}
      {ordered.length > 0 ? (
        <ol className="space-y-1">
          {ordered.map((id, idx) => {
            const t = phaseById.get(id)
            if (!t) return null
            const isDragging = dragIndex === idx
            const isDropTarget = overIndex === idx && dragIndex !== null && dragIndex !== idx
            return (
              <li
                key={id}
                draggable
                onDragStart={(e) => { setDragIndex(idx); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overIndex !== idx) setOverIndex(idx) }}
                onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) reorder(dragIndex, idx); setDragIndex(null); setOverIndex(null) }}
                onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}
                className={`flex items-center gap-2 bg-card border rounded-lg px-2.5 py-1.5 transition-colors ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'border-primary border-dashed bg-primary-soft' : 'border-border'}`}
              >
                <span className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 text-[var(--color-text-muted)] hover:text-primary touch-none" title="Dra for å endre rekkefølge" aria-label={`Dra ${t.name}`}><GripVertical size={14} /></span>
                <span className="w-4 text-right text-[10px] text-[var(--color-text-muted)] font-mono tabular-nums">{idx + 1}</span>
                <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: t.color ?? '#94A3B8' }} />
                <span className="text-xs text-[var(--color-text-primary)] flex-1 truncate">{t.name}</span>
                <button type="button" onClick={() => { setEditPhaseId(t.id); setEditPhaseName(t.name); setEditPhaseColor(t.color ?? '#94A3B8') }} className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-primary hover:bg-primary-soft" title={`Rediger «${t.name}»`} aria-label={`Rediger ${t.name}`}><Pencil size={12} /></button>
                <button type="button" onClick={() => removeFromList(id)} className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50" title="Fjern fra rekkefølgen" aria-label={`Fjern ${t.name} fra rekkefølgen`}><X size={13} /></button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="text-[11px] text-[var(--color-text-muted)]">Ingen egen rekkefølge — alle fasetyper er standard. Legg til faser under for å sette rekkefølgen.</p>
      )}

      {/* Faser som ikke er i lista — klikk for å legge til */}
      {notInList.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <span className="text-[10px] text-[var(--color-text-muted)]">Legg til:</span>
          {notInList.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border border-border bg-muted/40 text-[var(--color-text-secondary)]">
              <button type="button" onClick={() => addToList(t.id)} className="inline-flex items-center gap-1.5 hover:text-primary" title={`Legg til ${t.name}`}>
                <Plus size={11} />
                <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: t.color ?? '#94A3B8' }} />
                {t.name}
              </button>
              <button type="button" onClick={() => { setEditPhaseId(t.id); setEditPhaseName(t.name); setEditPhaseColor(t.color ?? '#94A3B8') }} className="p-0.5 rounded-full text-[var(--color-text-muted)] hover:text-primary" title={`Rediger «${t.name}»`} aria-label={`Rediger ${t.name}`}><Pencil size={10} /></button>
              <button type="button" onClick={() => deletePhaseType(t)} className="-mr-1 p-0.5 rounded-full text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50" title={`Slett «${t.name}» fra registeret`} aria-label={`Slett ${t.name}`}><Trash2 size={10} /></button>
            </span>
          ))}
        </div>
      )}
      {/* Inline-redigering av valgt fase (navn/farge — globalt) */}
      {editPhaseId && (
        <div className="flex items-center gap-2 flex-wrap bg-muted/40 border border-border rounded-lg p-2">
          <input
            type="text"
            value={editPhaseName}
            onChange={(e) => setEditPhaseName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); savePhaseEdit() } }}
            className="px-2.5 py-1.5 text-xs border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary w-44"
          />
          <input
            type="color"
            value={editPhaseColor}
            onChange={(e) => setEditPhaseColor(e.target.value)}
            title="Fasefarge"
            className="w-8 h-8 p-0.5 border border-border rounded-lg bg-card cursor-pointer"
          />
          <button
            type="button"
            onClick={savePhaseEdit}
            disabled={savingEdit || !editPhaseName.trim()}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
          >
            <Check size={12} /> {savingEdit ? 'Lagrer…' : 'Lagre'}
          </button>
          <button
            type="button"
            onClick={() => setEditPhaseId(null)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-border text-[var(--color-text-secondary)] hover:bg-muted"
          >
            <X size={12} /> Avbryt
          </button>
          <span className="text-[10px] text-[var(--color-text-muted)]">
            Endringen gjelder overalt der fasen vises — også på eksisterende prosjekter
          </span>
        </div>
      )}

      {/* Legg til nytt punkt i standardfasene (globalt fase-register) */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <input
          type="text"
          value={newPhaseName}
          onChange={(e) => setNewPhaseName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhaseType() } }}
          placeholder="Ny fase, f.eks. Asfaltering"
          className="px-2.5 py-1.5 text-xs border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary w-44"
        />
        <input
          type="color"
          value={newPhaseColor}
          onChange={(e) => setNewPhaseColor(e.target.value)}
          title="Fasefarge"
          className="w-8 h-8 p-0.5 border border-border rounded-lg bg-card cursor-pointer"
        />
        <button
          type="button"
          onClick={addPhaseType}
          disabled={addingPhase || !newPhaseName.trim()}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border bg-card text-[var(--color-text-secondary)] hover:bg-muted disabled:opacity-50"
        >
          <Plus size={12} /> {addingPhase ? 'Legger til…' : 'Ny fase'}
        </button>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          Nye faser blir tilgjengelige på alle prosjekter og i porteføljefilteret
        </span>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {dirty && (
        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={saving}>
            <Save size={14} className="mr-1" /> {saving ? 'Lagrer…' : 'Lagre rekkefølge'}
          </Button>
          {ordered.length === 0 && <span className="text-xs text-[var(--color-text-muted)]">Tom liste = alle fasetyper er standard</span>}
        </div>
      )}
    </div>
  )
}
