'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, Save, Pencil, Check, X } from 'lucide-react'
import type { PhaseType } from '@/components/admin/FremdriftsplanClient'
import Card from '@/components/ui/Card'
import Field from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import ErrorBox from '@/components/ui/ErrorBox'
import EmptyState from '@/components/ui/EmptyState'
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
    if (!confirm(`Slett typen «${t.name}»? Sjekklister på eksisterende prosjekter beholdes, men typen kobles fra.`)) return
    const res = await fetch(`/api/project-types/${t.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert(d.error ?? 'Sletting feilet')
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
      alert(d.error ?? 'Lagring feilet')
      return
    }
    refresh()
  }

  if (loading) return <div className="p-6 text-sm text-[var(--color-text-muted)]">Laster...</div>

  return (
    <div className="p-6 space-y-6">
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
            <input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="F.eks. Fiber FTTH"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
            />
          </Field>
          <Field label="Beskrivelse (valgfri)" className="sm:col-span-2">
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Kort beskrivelse"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
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

  useEffect(() => {
    setItems(type.items)
    setDirty(false)
  }, [type.items])

  function addItem(e: React.FormEvent) {
    e.preventDefault()
    if (!newItem.trim()) return
    setItems((prev) => [...prev, {
      id: `tmp_${Date.now()}`,
      project_type_id: type.id,
      label: newItem.trim(),
      sort_order: prev.length * 10,
      created_at: new Date().toISOString(),
    }])
    setNewItem('')
    setDirty(true)
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
    setDirty(true)
  }

  function moveItem(idx: number, dir: -1 | 1) {
    const target = idx + dir
    if (target < 0 || target >= items.length) return
    setItems((prev) => {
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
    setDirty(true)
  }

  function updateLabel(idx: number, label: string) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, label } : it)))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    const res = await fetch(`/api/project-types/${type.id}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map((i) => ({ label: i.label })) }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert(d.error ?? 'Lagring feilet')
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
          {type.items.length} {type.items.length === 1 ? 'punkt' : 'punkter'}
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
          {items.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Ingen punkter ennå. Legg til under.</p>
          ) : (
            <ul className="space-y-1">
              {items.map((item, idx) => (
                <li key={item.id} className="flex items-center gap-2 bg-card border border-border rounded px-3 py-1.5">
                  <span className="text-xs text-[var(--color-text-muted)] font-mono w-6">{idx + 1}.</span>
                  <input
                    value={item.label}
                    onChange={(e) => updateLabel(idx, e.target.value)}
                    className="flex-1 text-sm bg-transparent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => moveItem(idx, -1)}
                    disabled={idx === 0}
                    className="text-xs text-[var(--color-text-muted)] hover:text-primary disabled:opacity-30 px-1"
                    title="Flytt opp"
                  >↑</button>
                  <button
                    type="button"
                    onClick={() => moveItem(idx, 1)}
                    disabled={idx === items.length - 1}
                    className="text-xs text-[var(--color-text-muted)] hover:text-primary disabled:opacity-30 px-1"
                    title="Flytt ned"
                  >↓</button>
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="text-[var(--color-text-muted)] hover:text-red-600"
                    title="Fjern punkt"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={addItem} className="flex gap-2 pt-2">
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Nytt sjekklistepunkt"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={!newItem.trim()}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-muted hover:bg-gray-200 text-[var(--color-text-primary)] rounded-lg font-medium disabled:opacity-50"
            >
              <Plus size={14} /> Legg til
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
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

  async function savePhaseEdit() {
    if (!editPhaseId || !editPhaseName.trim()) return
    setSavingEdit(true); setError('')
    const res = await fetch('/api/phase-types', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editPhaseId, name: editPhaseName.trim(), color: editPhaseColor }),
    })
    setSavingEdit(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError((d as { error?: string }).error ?? 'Lagring feilet')
      return
    }
    const updated = await res.json() as PhaseType
    setPhaseTypes((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setEditPhaseId(null)
  }

  async function deletePhaseType(pt: PhaseType) {
    if (!confirm(`Fjern fasen «${pt.name}» fra registeret? Den forsvinner fra fasevelgeren overalt. Faser som allerede ligger på prosjekter blokkerer sletting.`)) return
    setError('')
    const res = await fetch(`/api/phase-types?id=${pt.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError((d as { error?: string }).error ?? 'Sletting feilet')
      return
    }
    setPhaseTypes((prev) => prev.filter((t) => t.id !== pt.id))
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(pt.id)
      return next
    })
  }

  async function addPhaseType() {
    const name = newPhaseName.trim()
    if (!name) return
    setAddingPhase(true); setError('')
    const res = await fetch('/api/phase-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: newPhaseColor }),
    })
    setAddingPhase(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError((d as { error?: string }).error ?? 'Kunne ikke opprette fasen')
      return
    }
    const created = await res.json() as PhaseType
    setPhaseTypes((prev) => [...prev, created])
    // Forhåndsvelg den nye fasen i malen. Var alt valgt fra før («alle er
    // standard»), forblir alt valgt — lagring gir fortsatt tom mal.
    setSelected((prev) => {
      const next = new Set(prev)
      next.add(created.id)
      return next
    })
    setNewPhaseName('')
    if (configured) setDirty(true)
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/phase-types').then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/project-types/${typeId}/default-phases`).then((r) => (r.ok ? r.json() : { configured: false, phase_type_ids: [] })),
    ]).then(([pt, cfg]) => {
      if (cancelled) return
      const all = (Array.isArray(pt) ? pt : []) as PhaseType[]
      const active = all.filter((t) => t.is_active)
      setPhaseTypes(active)
      const c = cfg as { configured: boolean; phase_type_ids: string[] }
      setConfigured(c.configured)
      // Ingen mal = alle er standard → alt forhåndshukes.
      setSelected(new Set(c.configured ? c.phase_type_ids : active.map((t) => t.id)))
      setLoaded(true)
    }).catch(() => setLoaded(true))
    return () => { cancelled = true }
  }, [typeId])

  if (!loaded || phaseTypes.length === 0) return null

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setDirty(true)
  }

  async function save() {
    setSaving(true); setError('')
    // Alle huket av = ingen egen mal (tom liste) → «alle er standard».
    const allChecked = selected.size === phaseTypes.length
    const ids = allChecked ? [] : phaseTypes.filter((t) => selected.has(t.id)).map((t) => t.id)
    const res = await fetch(`/api/project-types/${typeId}/default-phases`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase_type_ids: ids }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError((d as { error?: string }).error ?? 'Lagring feilet')
      return
    }
    setConfigured(ids.length > 0)
    setDirty(false)
  }

  return (
    <div className="pt-3 border-t border-border space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold text-[var(--color-text-primary)]">Standardfaser</h4>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {configured ? 'Egen mal for denne typen' : 'Alle fasetyper er standard'}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {phaseTypes.map((t) => {
          const checked = selected.has(t.id)
          return (
            <label
              key={t.id}
              className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border cursor-pointer transition-colors ${
                checked
                  ? 'bg-card border-[var(--color-border-strong)] text-[var(--color-text-primary)]'
                  : 'bg-muted/50 border-border text-[var(--color-text-muted)] opacity-60'
              }`}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(t.id)} className="sr-only" />
              <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: t.color ?? '#94A3B8' }} />
              {t.name}
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditPhaseId(t.id); setEditPhaseName(t.name); setEditPhaseColor(t.color ?? '#94A3B8') }}
                className="p-0.5 rounded-full text-[var(--color-text-muted)] hover:text-primary hover:bg-primary-soft"
                title={`Rediger «${t.name}» (navn/farge)`}
                aria-label={`Rediger ${t.name}`}
              >
                <Pencil size={10} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); deletePhaseType(t) }}
                className="-mr-1 p-0.5 rounded-full text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50"
                title={`Slett «${t.name}» fra registeret`}
                aria-label={`Slett ${t.name}`}
              >
                <Trash2 size={10} />
              </button>
            </label>
          )
        })}
      </div>
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
          <Button type="button" onClick={save} disabled={saving || selected.size === 0}>
            <Save size={14} className="mr-1" /> {saving ? 'Lagrer…' : 'Lagre standardfaser'}
          </Button>
          {selected.size === 0 && <span className="text-xs text-amber-700">Velg minst én fase</span>}
        </div>
      )}
    </div>
  )
}
