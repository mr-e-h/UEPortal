'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Search, X, FileText, Clock } from 'lucide-react'

interface PickerProject {
  id: string
  name: string
  project_number: string
  pending_em_count?: number
  pending_weekly_count?: number
}

/**
 * Two-step quick action: admin clicks "Send endringsmelding" or "Send
 * ukesrapport" on the dashboard → this picker opens → user picks the
 * project → we route them to the project page with the right action.
 *
 *   action="new-em"        → /subcontractor/projects/{id}?action=new-em
 *                            (the project page reads ?action and auto-opens
 *                             the ChangeOrderModal)
 *   action="weekly-report" → /subcontractor/projects/{id}?action=weekly-report
 *                            (the project page reads ?action, scrolls the
 *                             weekly-report card into view and starts a draft)
 */
export default function ProjectPickerModal({
  projects,
  action,
  onClose,
}: {
  projects: PickerProject[]
  action: 'new-em' | 'weekly-report'
  onClose: () => void
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')

  // Esc closes — small QoL since the user came in to do one specific thing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = search.trim().toLowerCase()
  const filtered = q
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(q) || p.project_number.toLowerCase().includes(q),
      )
    : projects

  const heading = action === 'new-em' ? 'Hvilket prosjekt gjelder endringsmeldingen?' : 'Hvilket prosjekt gjelder ukesrapporten?'
  const subText = action === 'new-em' ? 'Velg prosjektet, så åpner vi endringsmelding-skjemaet for deg.' : 'Velg prosjektet, så tar vi deg til ukesrapport-skjemaet.'

  function pick(id: string) {
    onClose()
    router.push(`/subcontractor/projects/${id}?action=${action}`)
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[70] flex items-start justify-center pt-24 px-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{heading}</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{subText}</p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            aria-label="Lukk"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              autoFocus
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk navn eller prosjektnummer..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <ul className="overflow-y-auto flex-1 divide-y divide-border">
          {filtered.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">
              {projects.length === 0
                ? 'Du har ingen prosjekter tildelt enda.'
                : 'Ingen treff på søket.'}
            </li>
          ) : (
            filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => pick(p.id)}
                  className="w-full text-left px-5 py-3 hover:bg-muted transition-colors flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{p.name}</p>
                    <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{p.project_number}</p>
                  </div>
                  {/* Pending badges so the UE can see "this project has 2 EMs
                      still waiting" before they create another one. */}
                  <div className="flex-none flex items-center gap-1.5">
                    {(p.pending_em_count ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                        <FileText size={9} /> {p.pending_em_count}
                      </span>
                    )}
                    {(p.pending_weekly_count ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                        <Clock size={9} /> {p.pending_weekly_count}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
