'use client'

import { useMemo, useState } from 'react'
import { History, ArrowRight } from 'lucide-react'
import { diffSnapshots } from '@/lib/production-diff'
import type { ProductionVersion } from '@/types'

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: '2-digit' }) +
    ' · ' +
    d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
  )
}

interface Props {
  versions: ProductionVersion[]
  /** Map from project_budget_line_id → lesbelt produktlabel (valgfri, for å berike diff). */
  productLabelByLineId?: Map<string, string>
}

/**
 * Versjonsliste + diff-panel for egenproduksjons-historikk.
 *
 * Mønster fra PhasesHistory: fast versjonsliste til venstre (~17 rem), diff-panel
 * til høyre. INGEN overflow-x-auto — holdes innenfor bredden.
 */
export default function ProductionHistory({ versions, productLabelByLineId }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    // Standard: vis forrige versjon mot nåværende (slik at siste endring er synlig).
    versions[1]?.id ?? versions[0]?.id ?? null,
  )

  if (versions.length === 0) {
    return (
      <section className="bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2 mb-1">
          <History size={15} /> Historikk
        </h2>
        <p className="text-xs text-[var(--color-text-muted)]">
          Ingen versjoner ennå. Endringer i egenproduksjon logges automatisk fra og med første lagring.
        </p>
      </section>
    )
  }

  const latest = versions[0]
  const selected = versions.find((v) => v.id === selectedId) ?? versions[0]
  const isLatestSelected = selected.id === latest.id

  // Diff: valgt versjon (gammel) → nåværende (ny).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const changes = useMemo(() => {
    const raw = diffSnapshots(selected.snapshot, latest.snapshot)
    if (productLabelByLineId) {
      raw.forEach((c) => { c.productLabel = productLabelByLineId.get(c.lineId) })
    }
    return raw
  }, [selected.snapshot, latest.snapshot, productLabelByLineId])

  return (
    <section className="bg-card border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
          <History size={15} /> Historikk
        </h2>
        <span className="text-xs text-[var(--color-text-muted)]">{versions.length} versjoner</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[17rem_1fr] gap-4">
        {/* Versjonsliste (nyeste først) */}
        <ol className="space-y-1 lg:max-h-[22rem] overflow-y-auto pr-1">
          {versions.map((v, i) => {
            const prev = versions[i + 1]
            const d = prev ? diffSnapshots(prev.snapshot, v.snapshot) : []
            const isSel = v.id === selected.id
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                    isSel ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--color-text-primary)]">
                      {fmtWhen(v.taken_at)}
                    </span>
                    {i === 0 && (
                      <span className="text-[9px] uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded px-1">
                        Nå
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)] truncate">
                    {v.taken_by_name || 'Ukjent'}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                    {!prev
                      ? 'utgangspunkt'
                      : d.length === 0
                      ? 'ingen endring'
                      : `${d.length} felt endret`}
                  </div>
                </button>
              </li>
            )
          })}
        </ol>

        {/* Diff-panel */}
        <div className="min-w-0 space-y-2">
          <p className="text-xs text-[var(--color-text-muted)]">
            {isLatestSelected
              ? 'Valgt versjon er den nåværende — velg en eldre versjon til venstre for å se forskjellen.'
              : (
                <>
                  Endringer fra{' '}
                  <span className="font-medium text-[var(--color-text-secondary)]">
                    {fmtWhen(selected.taken_at)}
                  </span>{' '}
                  til nåværende.
                </>
              )}
          </p>

          {!isLatestSelected && (
            <div className="space-y-1">
              {changes.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Ingen forskjell fra nåværende tilstand.
                </p>
              ) : (
                changes.map((c, idx) => (
                  <div
                    key={`${c.lineId}-${c.field}-${idx}`}
                    className="text-xs text-[var(--color-text-secondary)]"
                  >
                    <span className="font-medium text-[var(--color-text-primary)]">
                      {c.productLabel ?? c.lineId}
                    </span>
                    {' — '}
                    {c.field}{': '}
                    <span className="text-[var(--color-text-muted)]">{c.from}</span>
                    <ArrowRight
                      size={10}
                      className="inline mx-0.5 -mt-0.5 text-[var(--color-text-muted)]"
                    />
                    <span className="text-[var(--color-text-primary)]">{c.to}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
