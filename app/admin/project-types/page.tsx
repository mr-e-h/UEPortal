'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, Save } from 'lucide-react'
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
        </div>
      )}
    </Card>
  )
}
