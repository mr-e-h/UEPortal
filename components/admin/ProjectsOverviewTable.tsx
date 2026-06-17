'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronUp, ChevronDown, FileText, ClipboardList, CheckSquare } from 'lucide-react'
import { fmtNOK, fmtDateShort as fmtDate } from '@/lib/format'
import { HEALTH_LABEL, HEALTH_RANK } from '@/lib/project-health'
import type { ProjectCardData } from '@/components/admin/ProjectsOverviewClient'

type Filter = 'all' | 'attention' | 'late' | 'mine'
type SortKey = 'priority' | 'name' | 'health' | 'progress' | 'revenue' | 'end'

const HEALTH_DOT: Record<string, string> = { green: 'bg-green-500', amber: 'bg-amber-400', red: 'bg-red-500' }
const HEALTH_TEXT: Record<string, string> = { green: 'text-green-700', amber: 'text-amber-700', red: 'text-red-600' }

/** Volumfremdrift når den finnes, ellers tidsfremdrift — for sortering. */
const workOf = (c: ProjectCardData) => (c.progress_source === 'volum' ? c.progress : null)

export default function ProjectsOverviewTable({
  cards,
  meName,
  controls = false,
}: {
  cards: ProjectCardData[]
  meName: string
  controls?: boolean
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('priority')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const showEconomy = cards.some((c) => c.revenue !== null)

  const counts = useMemo(() => ({
    all: cards.length,
    attention: cards.filter((c) => c.attention.change_orders + c.attention.weekly_reports > 0).length,
    late: cards.filter((c) => c.health === 'red').length,
    mine: cards.filter((c) => c.pm_names.includes(meName)).length,
  }), [cards, meName])

  const rows = useMemo(() => {
    const filtered = cards.filter((c) => {
      if (filter === 'attention') return c.attention.change_orders + c.attention.weekly_reports > 0
      if (filter === 'late') return c.health === 'red'
      if (filter === 'mine') return c.pm_names.includes(meName)
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    const cmp = (a: ProjectCardData, b: ProjectCardData): number => {
      switch (sortKey) {
        case 'name': return a.name.localeCompare(b.name, 'nb') * dir
        case 'health': return (HEALTH_RANK[a.health] - HEALTH_RANK[b.health]) * dir
        case 'progress': return ((workOf(a) ?? a.progress ?? -1) - (workOf(b) ?? b.progress ?? -1)) * dir
        case 'revenue': return ((a.revenue ?? -1) - (b.revenue ?? -1)) * dir
        case 'end': return ((a.end_date ?? '9999').localeCompare(b.end_date ?? '9999')) * dir
        default: {
          // priority: rød + flest saker + nærmeste sluttdato øverst.
          const h = HEALTH_RANK[b.health] - HEALTH_RANK[a.health]
          if (h) return h
          const at = b.attention.total - a.attention.total
          if (at) return at
          return (a.end_date ?? '9999').localeCompare(b.end_date ?? '9999')
        }
      }
    }
    return [...filtered].sort(cmp)
  }, [cards, filter, sortKey, sortDir, meName])

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  const SortHead = ({ k, label, align = 'left' }: { k: SortKey; label: string; align?: 'left' | 'right' }) => (
    <th className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => sortBy(k)} className={`inline-flex items-center gap-1 hover:text-[var(--color-text-primary)] ${sortKey === k ? 'text-[var(--color-text-primary)]' : ''}`}>
        {label}
        {sortKey === k && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </button>
    </th>
  )

  return (
    <div>
      {controls && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap text-xs">
          {([
            ['all', 'Alle'], ['attention', 'Krever oppmerksomhet'], ['late', 'Forsinket'], ['mine', 'Min portefølje'],
          ] as [Filter, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-2.5 py-1 rounded-full border transition-colors ${
                filter === key
                  ? 'bg-primary-soft text-primary border-primary-soft'
                  : 'border-border text-[var(--color-text-secondary)] hover:bg-muted'
              }`}
            >
              {label} <span className="text-[var(--color-text-muted)]">{counts[key]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted border-b border-border text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                <SortHead k="name" label="Prosjekt" />
                <SortHead k="health" label="Helse" />
                <SortHead k="progress" label="Fremdrift / tid" />
                {showEconomy && <SortHead k="revenue" label="Ordreverdi" align="right" />}
                <SortHead k="end" label="Slutt" align="right" />
                <th className="px-3 py-2 font-medium text-right" style={{ width: '160px' }}>Saker</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={showEconomy ? 6 : 5} className="px-3 py-8 text-center text-[var(--color-text-muted)]">Ingen prosjekter i dette utvalget.</td></tr>
              ) : rows.map((c) => {
                const work = workOf(c)
                const time = c.time_progress
                return (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/admin/projects/${c.id}`)}
                    className="border-b border-border last:border-0 hover:bg-muted/60 cursor-pointer"
                  >
                    {/* Prosjekt */}
                    <td className="px-3 py-2.5 max-w-[260px]">
                      <Link href={`/admin/projects/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-[var(--color-text-primary)] hover:text-primary block truncate">
                        {c.name}
                      </Link>
                      <span className="block text-[11px] text-[var(--color-text-muted)] truncate">
                        {[c.customer, c.pm_names[0]].filter(Boolean).join(' · ') || c.project_number}
                      </span>
                    </td>
                    {/* Helse */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 text-xs ${HEALTH_TEXT[c.health]}`}>
                        <span className={`w-2 h-2 rounded-full flex-none ${HEALTH_DOT[c.health]}`} />
                        {HEALTH_LABEL[c.health]}
                      </span>
                    </td>
                    {/* Fremdrift vs tid */}
                    <td className="px-3 py-2.5 min-w-[140px]">
                      {work === null && time === null ? (
                        <span className="text-xs text-[var(--color-text-muted)]">–</span>
                      ) : (
                        <>
                          <div className="relative h-2 rounded-full bg-muted overflow-visible">
                            <div className={`absolute inset-y-0 left-0 rounded-full ${HEALTH_DOT[c.health]}`} style={{ width: `${work ?? time ?? 0}%` }} />
                            {work !== null && time !== null && (
                              <span className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-[var(--color-text-primary)]" style={{ left: `${time}%` }} title={`Tid brukt: ${time}%`} />
                            )}
                          </div>
                          <span className="block text-[10px] text-[var(--color-text-muted)] mt-1 tabular-nums">
                            {work !== null ? `${work}% volum · ${time ?? 0}% tid` : `${time}% tid`}
                          </span>
                        </>
                      )}
                    </td>
                    {/* Ordreverdi + fakturert % */}
                    {showEconomy && (
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <span className="font-medium text-[var(--color-text-primary)] tabular-nums">{fmtNOK(c.revenue ?? 0)}</span>
                        {c.revenue != null && c.revenue > 0 && c.invoiced != null && (
                          <span className="block text-[11px] text-[var(--color-text-muted)]">{Math.round((c.invoiced / c.revenue) * 100)}% fakturert</span>
                        )}
                      </td>
                    )}
                    {/* Slutt */}
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-[var(--color-text-secondary)] text-xs tabular-nums">
                      {c.end_date ? fmtDate(c.end_date) : 'pågående'}
                    </td>
                    {/* Saker — fargede pills så prosjekter med ventende saker stikker seg ut */}
                    <td className="px-3 py-2.5 align-middle" style={{ width: '160px' }}>
                      {c.attention.total === 0 ? (
                        <span className="block text-right text-sm text-[var(--color-text-muted)]">–</span>
                      ) : (
                        <span className="flex items-center justify-end gap-1.5 flex-wrap">
                          {c.attention.change_orders > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-warning-soft text-warning text-[11px] font-semibold" title={`${c.attention.change_orders} endringsmelding(er) venter`}>
                              <FileText size={13} />{c.attention.change_orders} EM
                            </span>
                          )}
                          {c.attention.weekly_reports > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-warning-soft text-warning text-[11px] font-semibold" title={`${c.attention.weekly_reports} ukesrapport(er) til behandling`}>
                              <ClipboardList size={13} />{c.attention.weekly_reports} rapp.
                            </span>
                          )}
                          {c.attention.open_tasks > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-[var(--color-text-muted)] text-[11px] font-medium" title={`${c.attention.open_tasks} åpne sjekklistepunkt(er)`}>
                              <CheckSquare size={13} />{c.attention.open_tasks}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
