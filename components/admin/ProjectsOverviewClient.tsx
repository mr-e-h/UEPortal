'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LayoutGrid, List, Bell, CalendarRange, HardHat, Wallet, User as UserIcon } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import type { BadgeStatus } from '@/components/ui/Badge'
import ProjectsOverviewTable from '@/components/admin/ProjectsOverviewTable'
import { HEALTH_LABEL, type Health } from '@/lib/project-health'
import { fmtDateShort as fmtDate, fmtNOK } from '@/lib/format'
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
  /** Tidsandel 0–100 (hvor langt i perioden), null uten datoer. */
  time_progress: number | null
  /** Prosjekthelse — grønn/gul/rød, beregnet server-side (lib/project-health). */
  health: Health
  /** Ordreverdi (total kontraktsverdi). null for byggeleder — aldri serialisert. */
  revenue: number | null
  /** Fakturert hittil. null for byggeleder. */
  invoiced: number | null
  attention: {
    change_orders: number
    weekly_reports: number
    open_tasks: number
    total: number
  }
}

const HEALTH_DOT: Record<Health, string> = { green: 'bg-green-500', amber: 'bg-amber-400', red: 'bg-red-500' }

// Bumpet fra v1 så den nye tabellvisningen blir standard for alle (gamle lagrede
// «cards»-valg fra forrige versjon overstyrer ikke det nye utgangspunktet).
const VIEW_KEY = 'projects_view_mode_v2'

/**
 * Prosjektoversikt: porteføljestripe (nøkkeltall) øverst, så tabell (standard)
 * eller kort. Tabellen har helse-ampel, fremdrift-vs-tid, filtre og sortering.
 * Alt økonomi-innhold er null for byggeleder (aldri serialisert), så stripa +
 * kolonnene skjuler seg automatisk for dem.
 */
export default function ProjectsOverviewClient({
  cards,
  activeProjects,
  restProjects,
  meName,
}: {
  cards: ProjectCardData[]
  activeProjects: Project[]
  restProjects: Project[]
  blCounts: Record<string, number>
  subCounts: Record<string, number>
  meName: string
}) {
  const [view, setView] = useState<'table' | 'cards'>('table')

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_KEY)
    if (saved === 'cards') setView('cards')
  }, [])

  function switchView(next: 'table' | 'cards') {
    setView(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* ignore */ }
  }

  const cardById = new Map(cards.map((c) => [c.id, c]))
  const activeCards = activeProjects.map((p) => cardById.get(p.id)).filter((c): c is ProjectCardData => !!c)
  const restCards = restProjects.map((p) => cardById.get(p.id)).filter((c): c is ProjectCardData => !!c)

  // ── Porteføljenøkkeltall (fra aktive prosjekter) ──────────────────────────
  const showEconomy = activeCards.some((c) => c.revenue !== null)
  const totalRevenue = activeCards.reduce((s, c) => s + (c.revenue ?? 0), 0)
  const totalInvoiced = activeCards.reduce((s, c) => s + (c.invoiced ?? 0), 0)
  const faktPct = totalRevenue > 0 ? Math.round((totalInvoiced / totalRevenue) * 100) : 0
  const attentionCount = activeCards.filter((c) => c.attention.change_orders + c.attention.weekly_reports > 0).length
  const lateCount = activeCards.filter((c) => c.health === 'red').length

  return (
    <div className="space-y-5">
      {/* Porteføljestripe */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {showEconomy && (
          <>
            <Kpi label="Samlet ordreverdi" value={fmtNOK(totalRevenue)} />
            <Kpi label="Fakturert" value={`${faktPct} %`} />
          </>
        )}
        <Kpi label="Krever oppmerksomhet" value={String(attentionCount)} tone={attentionCount > 0 ? 'amber' : 'default'} />
        <Kpi label="Forsinket" value={String(lateCount)} tone={lateCount > 0 ? 'red' : 'default'} />
      </div>

      {/* Visnings-toggle */}
      <div className="flex items-center justify-end">
        <div className="inline-flex items-center gap-0.5 bg-card border border-border rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => switchView('table')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${view === 'table' ? 'bg-primary-soft text-primary' : 'text-[var(--color-text-secondary)] hover:bg-muted'}`}
            aria-pressed={view === 'table'}
          >
            <List size={13} /> Tabell
          </button>
          <button
            type="button"
            onClick={() => switchView('cards')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${view === 'cards' ? 'bg-primary-soft text-primary' : 'text-[var(--color-text-secondary)] hover:bg-muted'}`}
            aria-pressed={view === 'cards'}
          >
            <LayoutGrid size={13} /> Kort
          </button>
        </div>
      </div>

      {view === 'table' ? (
        <>
          <section>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Aktive prosjekter</h2>
            <ProjectsOverviewTable cards={activeCards} meName={meName} controls />
          </section>
          {restCards.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Avsluttede / arkiverte</h2>
              <ProjectsOverviewTable cards={restCards} meName={meName} />
            </section>
          )}
        </>
      ) : (
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
      )}
    </div>
  )
}

function Kpi({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' | 'red' }) {
  const wrap = tone === 'amber' ? 'bg-warning-soft' : tone === 'red' ? 'bg-danger-soft' : 'bg-muted'
  const text = tone === 'amber' ? 'text-warning' : tone === 'red' ? 'text-danger' : 'text-[var(--color-text-primary)]'
  const lbl = tone === 'amber' ? 'text-warning' : tone === 'red' ? 'text-danger' : 'text-[var(--color-text-muted)]'
  return (
    <div className={`rounded-lg p-3 ${wrap}`}>
      <p className={`text-[11px] font-medium uppercase tracking-wide ${lbl}`}>{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-0.5 leading-tight ${text}`}>{value}</p>
    </div>
  )
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
      {/* Topp: navn + helse + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{card.name}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">
            {card.project_number}{card.customer ? ` · ${card.customer}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          {card.status === 'active' && (
            <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[card.health]}`} title={`Helse: ${HEALTH_LABEL[card.health]}`} />
          )}
          <Badge status={(card.status === 'active' ? 'active' : card.status === 'completed' ? 'completed' : 'archived') as BadgeStatus} />
        </div>
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
        {card.revenue !== null && (
          <p className="flex items-center gap-1.5">
            <Wallet size={12} className="flex-none text-[var(--color-text-muted)]" />
            <span>Ordreverdi: <span className="font-medium text-[var(--color-text-primary)] tabular-nums">{fmtNOK(card.revenue)}</span></span>
          </p>
        )}
      </div>

      {/* UE-chips */}
      <div className="mt-3 flex items-center gap-1.5 flex-wrap min-h-[22px]">
        <HardHat size={12} className="flex-none text-[var(--color-text-muted)]" />
        {chips.length === 0 ? (
          <span className="text-xs text-[var(--color-text-muted)]">Ingen UE</span>
        ) : (
          <>
            {chips.map((name) => (
              <span key={name} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-[var(--color-text-secondary)] truncate max-w-[110px]">
                {name}
              </span>
            ))}
            {moreChips > 0 && (
              <span title={card.sub_names.slice(maxChips).join(', ')} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-[var(--color-text-muted)]">
                +{moreChips}
              </span>
            )}
          </>
        )}
      </div>

      {/* Fremdrift */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] mb-1">
          <span title={card.progress_source === 'tid' ? 'Beregnet fra prosjektperiode, ikke rapporterte mengder' : undefined}>Fremdrift</span>
          <span>{card.progress !== null ? `${card.progress}%` : '–'}</span>
        </div>
        {card.progress !== null && (
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${card.progress}%` }} />
          </div>
        )}
      </div>

      {card.attention.total > 0 && (
        <span title={attentionTitle} className="absolute bottom-3 right-3 inline-flex items-center gap-1 bg-warning-soft text-warning text-[11px] font-semibold px-2 py-0.5 rounded-full">
          <Bell size={11} />
          {card.attention.total}
        </span>
      )}
    </Link>
  )
}
