'use client'

/**
 * Liste-/kømodulen: delt filterbar for oversiktslister (EM, ukesrapporter, …).
 * Tekstsøk + prosjekt + UE + status, med «Nullstill» og treff-teller.
 * Forelderen eier staten — denne komponenten er ren visning + callbacks,
 * så filterlogikken (useMemo over radene) bor der dataene bor.
 *
 * Alle filtrene er valgfrie: utelat f.eks. `subs` så vises ikke UE-velgeren.
 */

export type FilterOption = { value: string; label: string }

const selectCls = 'px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary'

export default function FilterBar({
  search,
  onSearch,
  searchPlaceholder = 'Søk…',
  searchLabel = 'Søk',
  projects,
  projectId = 'all',
  onProject,
  subs,
  subId = 'all',
  onSub,
  statusOptions,
  status = 'all',
  onStatus,
  matchCount,
}: {
  search: string
  onSearch: (v: string) => void
  searchPlaceholder?: string
  searchLabel?: string
  projects?: Array<{ id: string; name: string }>
  projectId?: string
  onProject?: (v: string) => void
  subs?: Array<{ id: string; name: string }>
  subId?: string
  onSub?: (v: string) => void
  statusOptions?: FilterOption[]
  status?: string
  onStatus?: (v: string) => void
  /** Antall rader etter filtrering — vises kun når et filter er aktivt. */
  matchCount: number
}) {
  const hasFilter = search.trim() !== '' || projectId !== 'all' || subId !== 'all' || status !== 'all'

  function reset() {
    onSearch('')
    onProject?.('all')
    onSub?.('all')
    onStatus?.('all')
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchLabel}
        className={`${selectCls} w-56`}
      />
      {projects && onProject && (
        <select value={projectId} onChange={(e) => onProject(e.target.value)} className={selectCls} aria-label="Filtrer på prosjekt">
          <option value="all">Alle prosjekter</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}
      {subs && onSub && (
        <select value={subId} onChange={(e) => onSub(e.target.value)} className={selectCls} aria-label="Filtrer på underentreprenør">
          <option value="all">Alle UE</option>
          {subs.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
      {statusOptions && onStatus && (
        <select value={status} onChange={(e) => onStatus(e.target.value)} className={selectCls} aria-label="Filtrer på status">
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
      {hasFilter && (
        <button
          type="button"
          onClick={reset}
          className="px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft rounded-md"
        >
          Nullstill
        </button>
      )}
      {hasFilter && (
        <span className="text-xs text-[var(--color-text-muted)]">
          {matchCount} treff
        </span>
      )}
    </div>
  )
}
