'use client'

import { X } from 'lucide-react'
import type { ActivityEntry } from '@/types'
import { fmtNOK as fmt } from '@/lib/format'
import { activityActionLabel } from '@/lib/activity-actions'
import { changeOrderStatus, changeOrderType } from '@/lib/statuses'

interface Props {
  entry: ActivityEntry | null
  /**
   * Looker upp produktnavn fra id (admin-EM-detalj sender en lambda som
   * bruker products-listen). Hvis udefinert (vanlig på UE-flater) faller
   * vi tilbake til å vise rå product_id — leselig nok så lenge IDer er
   * tekstlige produktkoder, ellers fortsatt brukbart for debugging.
   */
  productNameLookup?: (id: string) => string
  onClose: () => void
}

// ─── Label-mapping ────────────────────────────────────────────────────────

// Hovedfelt-labels for change_order-objektet i nested metadata. Bestemmer
// også sorteringsrekkefølge i Hovedfelter-tabellen (Object.keys-rekkefølge).
const CHANGE_ORDER_FIELDS: Record<string, string> = {
  em_type:                 'Type',
  status:                  'Status',
  reason:                  'Beskrivelse',
  solution:                'Løsning',
  product_id:              'Hovedprodukt',
  requested_quantity:      'Hovedmengde',
  unit:                    'Enhet',
  attachment_url:          'Vedlegg',
  cost_price_snapshot:     'UE-kostpris',
  customer_price_snapshot: 'Kundepris',
  total_cost:              'Total kostnad',
  total_customer_value:    'Salgsverdi',
  profit:                  'Fortjeneste',
}

// Felt-labels for per-linje-diff. consequence_lines bruker `quantity`,
// lines bruker `requested_quantity` — samme label.
const LINE_FIELDS: Record<string, string> = {
  requested_quantity:      'Mengde',
  quantity:                'Mengde',
  unit:                    'Enhet',
  cost_price_snapshot:     'UE-kostpris',
  customer_price_snapshot: 'Kundepris',
}

const MONEY_KEYS = new Set([
  'total_cost', 'total_customer_value', 'profit',
  'cost_price_snapshot', 'customer_price_snapshot',
])

// ─── Verdi-formatering ───────────────────────────────────────────────────

function formatValue(key: string, value: unknown, productNameLookup?: (id: string) => string): string {
  if (value === null || value === undefined || value === '') return '–'
  if (key === 'product_id' && typeof value === 'string') {
    return productNameLookup ? productNameLookup(value) : value
  }
  if (key === 'em_type' && typeof value === 'string') {
    return changeOrderType(value).label
  }
  if (key === 'status' && typeof value === 'string') {
    return changeOrderStatus(value).label
  }
  if (key === 'attachment_url') {
    return value ? 'Ja' : '–'
  }
  if (MONEY_KEYS.has(key) && typeof value === 'number') return fmt(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  // Defensive: hvis nested objekt sniker seg inn (skal ikke skje med flat
  // change_order-form) viser vi ikke rå JSON.
  return '–'
}

function formatLineValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '–'
  if (key === 'attachment_url') return value ? 'Ja' : '–'
  if (MONEY_KEYS.has(key) && typeof value === 'number') return fmt(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return '–'
}

// ─── Diff-typer + helpere ────────────────────────────────────────────────

type LineLike = { product_id: string; sort_order?: number; [k: string]: unknown }

type LineDiffEntry =
  | { type: 'added'; product_id: string; after: LineLike }
  | { type: 'removed'; product_id: string; before: LineLike }
  | { type: 'changed'; product_id: string; before: LineLike; after: LineLike; changedKeys: string[] }

/**
 * Bygg diff mellom to lister med produktlinjer eller konsekvens-linjer.
 * Matcher på product_id (vanlig tilfelle: én linje per produkt). Lines
 * uten endring filtreres bort — caller vil ikke se "uendret" støy.
 *
 * Hvis flere linjer har samme product_id (duplikat), tas KUN den første
 * fra hver side i matchet — resten dukker opp som add/remove. Akseptert
 * trade-off siden duplikater er sjeldne i praksis.
 */
function diffLines(
  before: LineLike[],
  after: LineLike[],
  fieldKeys: string[],
): LineDiffEntry[] {
  const beforeByPid = new Map<string, LineLike>()
  for (const l of before) if (!beforeByPid.has(l.product_id)) beforeByPid.set(l.product_id, l)
  const afterByPid = new Map<string, LineLike>()
  for (const l of after) if (!afterByPid.has(l.product_id)) afterByPid.set(l.product_id, l)

  const allPids = new Set<string>([
    ...Array.from(beforeByPid.keys()),
    ...Array.from(afterByPid.keys()),
  ])
  const result: LineDiffEntry[] = []

  for (const pid of Array.from(allPids)) {
    const b = beforeByPid.get(pid)
    const a = afterByPid.get(pid)
    if (b && a) {
      const changedKeys: string[] = []
      for (const k of fieldKeys) {
        if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changedKeys.push(k)
      }
      if (changedKeys.length === 0) continue
      result.push({ type: 'changed', product_id: pid, before: b, after: a, changedKeys })
    } else if (a) {
      result.push({ type: 'added', product_id: pid, after: a })
    } else if (b) {
      result.push({ type: 'removed', product_id: pid, before: b })
    }
  }
  return result
}

function getLineFieldKeysFor(lines: LineLike[]): string[] {
  // Bruker `quantity` på consequence_lines, `requested_quantity` på lines.
  // Ekstraherer fra første line så vi treffer faktiske felt-sett.
  const sample = lines[0] ?? {}
  const allKeys = Object.keys(LINE_FIELDS).filter((k) => k in sample)
  return allKeys.length > 0 ? allKeys : ['requested_quantity', 'quantity', 'unit', 'cost_price_snapshot']
}

// ─── Sub-komponenter ─────────────────────────────────────────────────────

function FieldDiffRow({
  fieldKey, label, oldVal, newVal, productNameLookup,
}: {
  fieldKey: string
  label: string
  oldVal: unknown
  newVal: unknown
  productNameLookup?: (id: string) => string
}) {
  const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal)
  if (!changed) return null
  return (
    <tr className="bg-yellow-50/60">
      <td className="px-3 py-2 text-xs font-medium text-gray-600">{label}</td>
      <td className="px-3 py-2 text-xs text-gray-700 tabular-nums">
        {formatValue(fieldKey, oldVal, productNameLookup)}
      </td>
      <td className="px-3 py-2 text-xs font-semibold text-gray-900 tabular-nums">
        {formatValue(fieldKey, newVal, productNameLookup)}
      </td>
    </tr>
  )
}

function ChangeBadge({ type }: { type: 'added' | 'removed' | 'changed' }) {
  const cls = type === 'added'
    ? 'bg-green-100 text-green-700'
    : type === 'removed'
      ? 'bg-red-100 text-red-700'
      : 'bg-amber-100 text-amber-700'
  const label = type === 'added' ? 'Lagt til' : type === 'removed' ? 'Fjernet' : 'Endret'
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>
      {label}
    </span>
  )
}

function LineDiffRow({
  diff, productNameLookup,
}: {
  diff: LineDiffEntry
  productNameLookup?: (id: string) => string
}) {
  const productLabel = productNameLookup ? productNameLookup(diff.product_id) : diff.product_id

  // Bygg detaljer-tekst pr. type.
  let details: React.ReactNode
  if (diff.type === 'added') {
    const qty = diff.after.requested_quantity ?? diff.after.quantity
    const unit = diff.after.unit
    details = (
      <span className="text-gray-700">
        {formatLineValue('requested_quantity', qty)} <span className="text-gray-400">{typeof unit === 'string' ? unit : ''}</span>
      </span>
    )
  } else if (diff.type === 'removed') {
    const qty = diff.before.requested_quantity ?? diff.before.quantity
    const unit = diff.before.unit
    details = (
      <span className="text-gray-500 line-through">
        {formatLineValue('requested_quantity', qty)} <span className="text-gray-400">{typeof unit === 'string' ? unit : ''}</span>
      </span>
    )
  } else {
    details = (
      <ul className="space-y-0.5">
        {diff.changedKeys.map((k) => (
          <li key={k} className="text-xs">
            <span className="text-gray-600">{LINE_FIELDS[k] ?? k}: </span>
            <span className="text-gray-500 line-through">{formatLineValue(k, diff.before[k])}</span>
            <span className="text-gray-400 mx-1">→</span>
            <span className="font-semibold text-gray-900">{formatLineValue(k, diff.after[k])}</span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <tr className="border-t border-gray-100">
      <td className="px-3 py-2 text-xs font-medium text-gray-900 align-top">{productLabel}</td>
      <td className="px-3 py-2 align-top"><ChangeBadge type={diff.type} /></td>
      <td className="px-3 py-2 text-xs align-top">{details}</td>
    </tr>
  )
}

// ─── Hovedkomponent ──────────────────────────────────────────────────────

/**
 * Modal som popups når en Versjonslogg-rad klikkes. Håndterer tre formater:
 *
 *  1. NESTET ('edited' og 'submitted' fra Prioritet 3+): metadata =
 *     { before/after: { change_order, lines, consequence_lines } }
 *     Rendres med tre seksjoner: Hovedfelter / Produktlinjer / Konsekvens.
 *
 *  2. SUBMITTED-spesialcase: bare `after` finnes. Rendres som
 *     "Opprinnelig innsending" — verdier som flat single-kolonne, ikke
 *     før/etter-diff.
 *
 *  3. FLAT (legacy fra før P3): metadata = { before/after: {fields...} }
 *     Rendres som original 3-kolonne diff.
 *
 * UE-strip: /api/activity strip-er customer_price_snapshot,
 * total_customer_value, profit rekursivt fra metadata for UE-requester.
 * Modal tåler at disse er undefined uten å krasje.
 */
export default function VersionDiffModal({ entry, productNameLookup, onClose }: Props) {
  if (!entry) return null

  const metadata = entry.metadata
  const beforeAny = (metadata?.before ?? {}) as Record<string, unknown>
  const afterAny = (metadata?.after ?? {}) as Record<string, unknown>

  // Detekter format: nestet hvis change_order/lines/consequence_lines finnes
  // som top-level keys i metadata.before eller .after.
  const isNested =
    'change_order' in beforeAny || 'change_order' in afterAny ||
    'lines' in beforeAny || 'lines' in afterAny ||
    'consequence_lines' in beforeAny || 'consequence_lines' in afterAny

  const isSubmitted = entry.action === 'submitted'

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Versjon</p>
            <h2 className="text-base font-semibold text-gray-900">
              {activityActionLabel(entry.action)}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {entry.actor} · {new Date(entry.created_at).toLocaleString('nb-NO', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Lukk"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {entry.comment && (
            <div className="text-sm bg-gray-50 border border-gray-200 rounded p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Sammendrag</p>
              <p className="text-gray-700">{entry.comment}</p>
            </div>
          )}

          {/* Submitted: vis som "Opprinnelig innsending" — kun after-data,
              ingen før/etter-diff. */}
          {isSubmitted && isNested ? (
            <SubmittedView after={afterAny} productNameLookup={productNameLookup} />
          ) : isNested ? (
            <NestedDiffView
              before={beforeAny}
              after={afterAny}
              productNameLookup={productNameLookup}
            />
          ) : (
            <FlatDiffView
              before={beforeAny}
              after={afterAny}
              productNameLookup={productNameLookup}
            />
          )}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
          >
            Lukk
          </button>
        </footer>
      </div>
    </div>
  )
}

// ─── View-komponenter ────────────────────────────────────────────────────

function SubmittedView({
  after, productNameLookup,
}: {
  after: Record<string, unknown>
  productNameLookup?: (id: string) => string
}) {
  const co = (after.change_order ?? {}) as Record<string, unknown>
  const lines = (after.lines ?? []) as LineLike[]
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded p-3">
        <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide">Opprinnelig innsending</p>
        <p className="text-xs text-blue-700 mt-0.5">Slik så endringsmeldingen ut da den ble sendt inn.</p>
      </div>

      <section>
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Hovedfelter</h3>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {Object.keys(CHANGE_ORDER_FIELDS).map((k) => {
              if (!(k in co)) return null
              return (
                <tr key={k}>
                  <td className="px-3 py-2 text-xs font-medium text-gray-600 w-1/3">{CHANGE_ORDER_FIELDS[k]}</td>
                  <td className="px-3 py-2 text-xs text-gray-900 tabular-nums">
                    {formatValue(k, co[k], productNameLookup)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {lines.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Produktlinjer</h3>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Produkt</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Mengde</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Enhet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l, i) => (
                <tr key={`${l.product_id}-${i}`}>
                  <td className="px-3 py-2 text-xs text-gray-900">
                    {productNameLookup ? productNameLookup(l.product_id) : l.product_id}
                  </td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-gray-900">
                    {formatLineValue('requested_quantity', l.requested_quantity ?? l.quantity)}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">{typeof l.unit === 'string' ? l.unit : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function NestedDiffView({
  before, after, productNameLookup,
}: {
  before: Record<string, unknown>
  after: Record<string, unknown>
  productNameLookup?: (id: string) => string
}) {
  const beforeCo = (before.change_order ?? {}) as Record<string, unknown>
  const afterCo = (after.change_order ?? {}) as Record<string, unknown>
  const beforeLines = (before.lines ?? []) as LineLike[]
  const afterLines = (after.lines ?? []) as LineLike[]
  const beforeConseq = (before.consequence_lines ?? []) as LineLike[]
  const afterConseq = (after.consequence_lines ?? []) as LineLike[]

  // Hovedfelter: vis bare felter som faktisk er endret.
  const fieldKeys = Object.keys(CHANGE_ORDER_FIELDS).filter(
    (k) => (k in beforeCo || k in afterCo) &&
      JSON.stringify(beforeCo[k]) !== JSON.stringify(afterCo[k]),
  )

  const lineFieldKeys = getLineFieldKeysFor(afterLines.length > 0 ? afterLines : beforeLines)
  const linesDiff = diffLines(beforeLines, afterLines, lineFieldKeys)

  const conseqFieldKeys = getLineFieldKeysFor(afterConseq.length > 0 ? afterConseq : beforeConseq)
  const conseqDiff = diffLines(beforeConseq, afterConseq, conseqFieldKeys)

  const hasAny = fieldKeys.length > 0 || linesDiff.length > 0 || conseqDiff.length > 0

  if (!hasAny) {
    return <p className="text-sm text-gray-400 italic">Ingen endringer registrert.</p>
  }

  return (
    <div className="space-y-5">
      {fieldKeys.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Hovedfelter</h3>
          <div className="overflow-x-auto rounded border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Felt</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Før</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Etter</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {fieldKeys.map((k) => (
                  <FieldDiffRow
                    key={k}
                    fieldKey={k}
                    label={CHANGE_ORDER_FIELDS[k]}
                    oldVal={beforeCo[k]}
                    newVal={afterCo[k]}
                    productNameLookup={productNameLookup}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {linesDiff.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Produktlinjer</h3>
          <div className="overflow-x-auto rounded border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-2/5">Produkt</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Endring</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Detaljer</th>
                </tr>
              </thead>
              <tbody>
                {linesDiff.map((d) => (
                  <LineDiffRow key={`line-${d.product_id}-${d.type}`} diff={d} productNameLookup={productNameLookup} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {conseqDiff.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Konsekvens ved avslag</h3>
          <div className="overflow-x-auto rounded border border-orange-200 bg-orange-50/30">
            <table className="w-full text-sm">
              <thead className="bg-orange-100/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-orange-900 w-2/5">Produkt</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-orange-900">Endring</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-orange-900">Detaljer</th>
                </tr>
              </thead>
              <tbody>
                {conseqDiff.map((d) => (
                  <LineDiffRow key={`conseq-${d.product_id}-${d.type}`} diff={d} productNameLookup={productNameLookup} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function FlatDiffView({
  before, after, productNameLookup,
}: {
  before: Record<string, unknown>
  after: Record<string, unknown>
  productNameLookup?: (id: string) => string
}) {
  // Eksisterende flat-format: behold 3-kolonne-tabellen. Brukes for
  // legacy-rader fra før Prioritet 3-restruktureringen.
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((k) => k in CHANGE_ORDER_FIELDS)
    .sort((a, b) => Object.keys(CHANGE_ORDER_FIELDS).indexOf(a) - Object.keys(CHANGE_ORDER_FIELDS).indexOf(b))

  if (allKeys.length === 0) {
    return <p className="text-sm text-gray-400 italic">Ingen detaljert diff lagret for denne hendelsen</p>
  }

  return (
    <div className="overflow-x-auto rounded border border-gray-100">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Felt</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Gammel verdi</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Ny verdi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {allKeys.map((key) => {
            const oldVal = before[key]
            const newVal = after[key]
            const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal)
            return (
              <tr key={key} className={changed ? 'bg-yellow-50/60' : ''}>
                <td className="px-3 py-2 text-xs font-medium text-gray-600">{CHANGE_ORDER_FIELDS[key] ?? key}</td>
                <td className="px-3 py-2 text-xs text-gray-700 tabular-nums">
                  {formatValue(key, oldVal, productNameLookup)}
                </td>
                <td className={`px-3 py-2 text-xs tabular-nums ${changed ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {formatValue(key, newVal, productNameLookup)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
