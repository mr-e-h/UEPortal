'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LayoutGrid, List, Bell, CalendarRange, HardHat, User as UserIcon } from 'lucide-react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import type { BadgeStatus } from '@/components/ui/Badge'
import ProjectsListTable from '@/components/admin/ProjectsListTable'
import type { Project } from '@/types'

export type ProjectCardData = {
  id: string
  name: string
  project_number: string
  customer: string
  county: string
  status: string
  start_date: string
  end_date: string | null
  pm_names: string[]
  sub_names: string[]
  /** 0–100, eller null når verken volum- eller tidsgrunnlag finnes. */
  progress: number | null
  progress_source: 'volum' | 'tid' | null
  attention: {
    change_orders: number
    weekly_reports: number
    open_tasks: number
    total: number
  }
}

const VIEW_KEY = 'projects_view_mode'

/**
 * Kort/tabell-toggle for prosjektoversikten. Kort er default; valget huskes i
 * localStorage. Tabellmodusen gjenbruker den eksisterende ProjectsListTable
 * uendret. Alt innhold er økonomifritt (trygt for byggeleder).
 */
export default function ProjectsOverviewClient({
  cards,
  activeProjects,
  restProjects,
  blCounts,
  subCounts,
}: {
  cards: ProjectCardData[]
  activeProjects: Project[]
  restProjects: Project[]
  blCounts: Record<string, number>
  subCounts: Record<string, number>
}) {
  const [view, setView] = useState<'cards' | 'table'>('cards')

  // Hydrer lagret visningsvalg etter mount (unngår SSR/klient-mismatch).
  useEffect(() => {
    const saved = localStorage.getItem(VIEW_KEY)
    if (saved === 'table') setView('table')
  }, [])

  function switchView(next: 'cards' | 'table') {
    setView(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* ignore */ }
  }

  const cardById = new Map(cards.map((c) => [c.id, c]))
  const activeCards = activeProjects.map((p) => cardById.get(p.id)).filter((c): c is ProjectCardData => !!c)
  const restCards = restProjects.map((p) => cardById.get(p.id)).filter((c): c is ProjectCardData => !!c)

  return (
    <div className="space-y-6">
      {/* Visnings-toggle */}
      <div className="flex items-center justify-end">
        <div className="inline-flex items-center gap-0.5 bg-card border border-border rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => switchView('cards')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              view === 'cards'
                ? 'bg-primary-soft text-primary'
                : 'text-[var(--color-text-secondary)] hover:bg-muted'
            }`}
            aria-pressed={view === 'cards'}
          >
            <LayoutGrid size={13} /> Kort
          </button>
          <button
            type="button"
            onClick={() => switchView('table')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              view === 'table'
                ? 'bg-primary-soft text-primary'
                : 'text-[var(--color-text-secondary)] hover:bg-muted'
            }`}
            aria-pressed={view === 'table'}
          >
            <List size={13} /> Tabell
          </button>
        </div>
      </div>

      {view === 'cards' ? (
        <>
          <section>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Aktive prosjekter</h2>
            {activeCards.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)] py-6 text-center">Ingen aktive prosjekter</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {activeCards.map((c) => <ProjectCard key={c.id} card={c} />)}
              </div>
            )}
          </section>

          {restCards.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Avsluttede / arkiverte</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {restCards.map((c) => <ProjectCard key={c.id} card={c} />)}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <Card>
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Aktive prosjekter</h2>
            </div>
            <ProjectsListTable projects={activeProjects} blCounts={blCounts} subCounts={subCounts} />
          </Card>
          {restProjects.length > 0 && (
            <Card>
              <div className="px-6 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Avsluttede / arkiverte</h2>
              </div>
              <ProjectsListTable projects={restProjects} blCounts={blCounts} subCounts={subCounts} />
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function fmtDate(d: string | null): string {
  if (!d) return '–'
  const [y, m, day] = d.split('-')
  return `${day}.${m}.${y.slice(2)}`
}

function ProjectCard({ card }: { card: ProjectCardData }) {
  const maxChips = 3
  const chips = card.sub_names.slice(0, maxChips)
  const moreChips = card.sub_names.length - chips.length

  const attentionTitle = [
    card.attention.change_orders > 0 ? `${card.attention.change_orders} endringsmelding(er) venter` : null,
    card.attention.weekly_reports > 0 ? `${card.attention.weekly_reports} ukesrapport(er) til behandling` : null,
    card.attention.open_tasks > 0 ? `${card.attention.open_tasks} åpne sjekklistepunkt(er)` : null,
  ].filter(Boolean).join(' · ')

  return (
    <Link
      href={`/admin/projects/${card.id}`}
      className="relative block bg-card border border-border rounded-2xl p-4 pb-5 hover:border-[var(--color-border-strong)] hover:shadow-sm transition-all"
    >
      {/* Topp: navn + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{card.name}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">
            {card.project_number}{card.customer ? ` · ${card.customer}` : ''}
          </p>
        </div>
        <Badge status={(card.status === 'active' ? 'active' : card.status === 'completed' ? 'completed' : 'archived') as BadgeStatus} />
      </div>

      {/* PL + periode */}
      <div className="mt-3 space-y-1.5 text-xs text-[var(--color-text-secondary)]">
        <p className="flex items-center gap-1.5 truncate">
          <UserIcon size={12} className="flex-none text-[var(--color-text-muted)]" />
          <span className="truncate">{card.pm_names.length > 0 ? card.pm_names.join(', ') : 'Ingen prosjektleder'}</span>
        </p>
        <p className="flex items-center gap-1.5">
          <CalendarRange size={12} className="flex-none text-[var(--color-text-muted)]" />
          {fmtDate(card.start_date)} – {card.end_date ? fmtDate(card.end_date) : 'pågående'}
        </p>
      </div>

      {/* UE-chips */}
      <div className="mt-3 flex items-center gap-1.5 flex-wrap min-h-[22px]">
        <HardHat size={12} className="flex-none text-[var(--color-text-muted)]" />
        {chips.length === 0 ? (
          <span className="text-xs text-[var(--color-text-muted)]">Ingen UE tilknyttet</span>
        ) : (
          <>
            {chips.map((name) => (
              <span key={name} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-[var(--color-text-secondary)] truncate max-w-[110px]">
                {name}
              </span>
            ))}
            {moreChips > 0 && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-[var(--color-text-muted)]">
                +{moreChips}
              </span>
            )}
          </>
        )}
      </div>

      {/* Fremdrift */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] mb-1">
          <span>Fremdrift{card.progress_source === 'tid' ? ' (tid)' : ''}</span>
          <span>{card.progress !== null ? `${card.progress}%` : '–'}</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${card.progress ?? 0}%` }}
          />
        </div>
      </div>

      {/* Oppmerksomhetsbadge nede til høyre */}
      {card.attention.total > 0 && (
        <span
          title={attentionTitle}
          className="absolute bottom-3 right-3 inline-flex items-center gap-1 bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-semibold px-2 py-0.5 rounded-full"
        >
          <Bell size={11} />
          {card.attention.total}
        </span>
      )}
    </Link>
  )
}
