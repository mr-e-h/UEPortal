'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  CheckSquare,
  Square,
  Trash2,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Plus,
} from 'lucide-react'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import ErrorBox from '@/components/ui/ErrorBox'
import { useConfirm } from '@/components/ui/useConfirm'
import type { ProjectChecklistItem, ProjectType } from '@/types'

interface Props {
  projectId: string
  projectTypeId: string | null
}

interface Section {
  header: ProjectChecklistItem | null // null = "items before first section"
  items: ProjectChecklistItem[]
}

/** Group a flat ordered list into sections. */
function buildSections(items: ProjectChecklistItem[]): Section[] {
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order)
  const sections: Section[] = []
  let current: Section = { header: null, items: [] }

  for (const row of sorted) {
    if (row.is_section) {
      // Only push the current group if it has content (header or items)
      if (current.header !== null || current.items.length > 0) {
        sections.push(current)
      }
      current = { header: row, items: [] }
    } else {
      current.items.push(row)
    }
  }
  // Always push the last group
  if (current.header !== null || current.items.length > 0) {
    sections.push(current)
  }

  return sections
}

export default function ChecklistSection({ projectId, projectTypeId }: Props) {
  const [items, setItems] = useState<ProjectChecklistItem[]>([])
  const [type, setType] = useState<ProjectType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [newLabel, setNewLabel] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const { confirm: confirmAction, confirmDialog } = useConfirm()

  // ─── Data loading ────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/checklist`)
    const data = await res.json().catch(() => [])
    if (Array.isArray(data)) setItems(data as ProjectChecklistItem[])
    setLoading(false)
  }, [projectId])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!projectTypeId) { setType(null); return }
    fetch('/api/project-types')
      .then((r) => r.ok ? r.json() : [])
      .then((arr: ProjectType[]) => {
        if (Array.isArray(arr)) setType(arr.find((t) => t.id === projectTypeId) ?? null)
      })
      .catch(() => {})
  }, [projectTypeId])

  // ─── Generate from template ──────────────────────────────────────────────────

  async function generate() {
    if (items.length > 0 && !(await confirmAction({
      title: 'Erstatt sjekklisten?',
      message: 'Eksisterende sjekkliste blir erstattet av typens mal. Avhukinger nullstilles.',
      confirmLabel: 'Erstatt',
    }))) return
    setError(null)
    const res = await fetch(`/api/projects/${projectId}/checklist`, { method: 'POST' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError((d as { error?: string }).error ?? 'Generering feilet')
      return
    }
    setCollapsed(new Set())
    refresh()
  }

  // ─── Toggle checkbox (optimistic) ────────────────────────────────────────────

  async function toggle(item: ProjectChecklistItem) {
    const next = !item.completed_at
    setItems((prev) => prev.map((i) => i.id === item.id ? {
      ...i,
      completed_at: next ? new Date().toISOString() : null,
      completed_by: next ? 'Deg' : null,
    } : i))
    const res = await fetch(`/api/projects/${projectId}/checklist/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: next }),
    })
    if (!res.ok) {
      setItems((prev) => prev.map((i) => i.id === item.id ? item : i))
    } else {
      refresh()
    }
  }

  // ─── Delete row (item or section header) ─────────────────────────────────────

  async function removeItem(item: ProjectChecklistItem) {
    const label = item.is_section ? 'seksjonsoverskriften' : `«${item.label}»`
    if (!(await confirmAction({
      title: item.is_section ? 'Slett seksjon?' : 'Slett sjekklistepunkt?',
      message: item.is_section
        ? `Seksjonen «${item.label}» slettes. Punktene under beholdes.`
        : `${label} fjernes fra prosjektets sjekkliste.`,
      confirmLabel: 'Slett',
    }))) return
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    await fetch(`/api/projects/${projectId}/checklist/${item.id}`, { method: 'DELETE' })
    refresh()
  }

  // ─── Add ad-hoc item or section ──────────────────────────────────────────────

  async function addRow(isSection: boolean) {
    const label = newLabel.trim()
    if (!label) return
    setAddBusy(true)
    setError(null)
    const res = await fetch(`/api/projects/${projectId}/checklist/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, is_section: isSection }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError((d as { error?: string }).error ?? 'Kunne ikke legge til')
    } else {
      setNewLabel('')
      refresh()
    }
    setAddBusy(false)
  }

  // ─── Collapse toggle ─────────────────────────────────────────────────────────

  function toggleCollapse(sectionId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  // ─── Derived state ────────────────────────────────────────────────────────────

  if (loading) return <div className="text-sm text-[var(--color-text-muted)]">Laster sjekkliste…</div>

  const checkableItems = items.filter((i) => !i.is_section)
  const totalCount = checkableItems.length
  const totalDone = checkableItems.filter((i) => !!i.completed_at).length
  const sections = buildSections(items)

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {confirmDialog}
      {error && <ErrorBox>{error}</ErrorBox>}

      {/* Progress header card */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
              Sjekkliste
              {type && (
                <span className="text-sm font-normal text-[var(--color-text-muted)]">
                  {' '}· basert på {type.name}
                </span>
              )}
            </h2>
            {totalCount > 0 && (
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                {totalDone} av {totalCount} ferdig
                {' · '}
                {Math.round((totalDone / totalCount) * 100)}%
              </p>
            )}
          </div>
          {projectTypeId && (
            <button
              type="button"
              onClick={generate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary-hover font-medium"
              title="Genererer sjekkliste på nytt fra typen — eksisterende avhukninger nullstilles"
            >
              <Sparkles size={13} />
              {items.length === 0 ? 'Generer fra type' : 'Generer på nytt'}
            </button>
          )}
        </div>

        {totalCount > 0 && (
          <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${(totalDone / totalCount) * 100}%` }}
            />
          </div>
        )}
      </Card>

      {/* Checklist body */}
      <Card>
        {items.length === 0 ? (
          <EmptyState
            title="Ingen sjekkliste enda"
            description={
              projectTypeId
                ? 'Klikk «Generer fra type» for å hente standard punktene.'
                : 'Sett en type på prosjektet (Rediger-knappen øverst) for å kunne generere en standard sjekkliste.'
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {sections.map((section, sIdx) => {
              const sectionKey = section.header?.id ?? `__pre_${sIdx}`
              const isCollapsed = collapsed.has(sectionKey)
              const sectionDone = section.items.filter((i) => !!i.completed_at).length
              const sectionTotal = section.items.length

              return (
                <li key={sectionKey}>
                  {/* Section header row */}
                  {section.header && (
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border group">
                      <button
                        type="button"
                        onClick={() => toggleCollapse(sectionKey)}
                        className="flex-none text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        aria-label={isCollapsed ? 'Utvid seksjon' : 'Skjul seksjon'}
                      >
                        {isCollapsed
                          ? <ChevronRight size={15} />
                          : <ChevronDown size={15} />
                        }
                      </button>
                      <span className="flex-1 text-sm font-semibold text-[var(--color-text-primary)] truncate">
                        {section.header.label}
                      </span>
                      {sectionTotal > 0 && (
                        <span className="text-xs text-[var(--color-text-muted)] tabular-nums shrink-0">
                          {sectionDone}/{sectionTotal}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeItem(section.header!)}
                        className="text-[var(--color-text-muted)] hover:text-red-600 flex-none opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Fjern seksjon"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}

                  {/* Items under section */}
                  {!isCollapsed && section.items.length > 0 && (
                    <ul className="divide-y divide-border">
                      {section.items.map((item) => {
                        const done = !!item.completed_at
                        return (
                          <li
                            key={item.id}
                            className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/30 group ${section.header ? 'pl-10' : 'pl-5'}`}
                          >
                            <button
                              type="button"
                              onClick={() => toggle(item)}
                              className="flex-none"
                              aria-label={done ? 'Marker som ikke ferdig' : 'Marker som ferdig'}
                            >
                              {done ? (
                                <CheckSquare size={18} className="text-green-600" />
                              ) : (
                                <Square size={18} className="text-[var(--color-text-muted)] hover:text-primary" />
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm ${done ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`}>
                                {item.label}
                              </p>
                              {done && item.completed_by && (
                                <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                                  Fullført av {item.completed_by}
                                  {item.completed_at && (
                                    <>{' · '}{new Date(item.completed_at).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' })}</>
                                  )}
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeItem(item)}
                              className="text-[var(--color-text-muted)] hover:text-red-600 flex-none opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Fjern punkt"
                            >
                              <Trash2 size={14} />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {/* Collapsed indicator */}
                  {isCollapsed && section.items.length > 0 && (
                    <p className="px-10 py-1.5 text-xs text-[var(--color-text-muted)] italic">
                      {section.items.length} punkt{section.items.length !== 1 ? 'er' : ''} skjult
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {/* Ad-hoc add footer */}
        <div className="px-5 py-3 border-t border-border flex gap-2 items-center flex-wrap">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addRow(false) } }}
            placeholder="Legg til punkt eller seksjon…"
            className="flex-1 min-w-40 px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => addRow(false)}
            disabled={!newLabel.trim() || addBusy}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-muted hover:bg-gray-200 text-[var(--color-text-primary)] rounded-lg font-medium disabled:opacity-50 shrink-0"
          >
            <Plus size={13} /> Punkt
          </button>
          <button
            type="button"
            onClick={() => addRow(true)}
            disabled={!newLabel.trim() || addBusy}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-muted hover:bg-gray-200 text-[var(--color-text-primary)] rounded-lg font-medium disabled:opacity-50 shrink-0"
          >
            <Plus size={13} /> Seksjon
          </button>
        </div>
      </Card>
    </div>
  )
}
