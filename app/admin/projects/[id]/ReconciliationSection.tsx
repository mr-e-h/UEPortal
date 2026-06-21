'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import ErrorBox from '@/components/ui/ErrorBox'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Field from '@/components/ui/Field'
import Select from '@/components/ui/Select'
import NumberInput from '@/components/NumberInput'
import ProductionHistory from './ProductionHistory'
import { fmtNOK as fmt, fmtProductLabel } from '@/lib/format'
import { reconciliationStatus, RECONCILIATION_STATUSES } from '@/lib/statuses'
import type {
  Product,
  ProjectBudgetLine,
  ProductionEntry,
  ProductionVersion,
  ReconciliationLine,
  ReconciliationStatus,
  Subcontractor,
  WeeklyReport,
  WeeklyReportLine,
} from '@/types'

type WRWithLines = WeeklyReport & { lines: WeeklyReportLine[] }

interface Props {
  budgetLines: ProjectBudgetLine[]
  allProducts: Product[]
  allSubs: Subcontractor[]
  productionEntries: ProductionEntry[]
  reconciliationLines: ReconciliationLine[]
  weeklyReportsWL: WRWithLines[]
  productionVersions: ProductionVersion[]
  /** Prosjektets avstemmingsstatus (default 'not_started'). */
  reconciliationStatusValue: ReconciliationStatus
  /**
   * Kun admin/PL (canSeeCustomerEconomics) ser planlagt verdi + differanse-verdi.
   * Byggeleder når aldri denne fanen, men prop'en holder isolasjonen eksplisitt.
   */
  canSeeValue: boolean
  /** Registrer utført produksjon (uten/med UE-kost) → POST production-entries. */
  onAddProductionEntry: (input: {
    product_id: string
    quantity: number
    project_budget_line_id?: string | null
    unit?: string
    executed_by: 'subcontractor' | 'internal' | 'other'
    subcontractor_id?: string | null
    cost?: number
    comment?: string
  }) => Promise<{ ok: boolean; error?: string }>
  /**
   * Lagre saksbehandling på en avstemmingslinje → UPSERT reconciliation-lines på
   * (project_id, project_budget_line_id).
   */
  onSaveReconciliationLine: (input: {
    project_budget_line_id: string
    product_id: string
    planned_quantity?: number | null
    executed_ue_quantity?: number | null
    executed_no_cost_quantity?: number | null
    diff_quantity?: number | null
    diff_customer_value?: number | null
    resolution?: string
    handled?: boolean
  }) => Promise<{ ok: boolean; error?: string }>
  /** Sett prosjektets avstemmingsstatus → PUT projects reconciliation_status. */
  onSetReconciliationStatus: (status: ReconciliationStatus) => Promise<{ ok: boolean; error?: string }>
  /** Batch-lagring av egenproduksjon → PUT /api/production-entries/batch. */
  saveProductionBatch: (rows: Array<{
    project_budget_line_id: string
    product_id: string
    unit?: string
    quantity: number
    resolution?: string
    handled?: boolean
  }>) => Promise<{ ok: boolean; upserted?: number; deleted?: number; error?: string }>
}

// Neste steg i status-arbeidsflyten.
const NEXT_STATUS: Partial<Record<ReconciliationStatus, { next: ReconciliationStatus; label: string }>> = {
  not_started: { next: 'in_progress', label: 'Start avstemming' },
  in_progress: { next: 'ready_for_final_check', label: 'Klar for sluttsjekk' },
  ready_for_final_check: { next: 'reconciled', label: 'Marker som avstemt' },
}

/**
 * «Avstemming»-fanen. Tre deler:
 *   (a) Regneark-grid: planlagt vs utført per budsjettlinje, redigerbar egenprod-kolonne,
 *       live-utregning, batch-lagring, endringshistorikk.
 *   (b) Sekundær «Ny fri føring»: registrer utført produksjon uten budsjettlinje.
 *   (c) Status-arbeidsflyt fram til 'reconciled'.
 *
 * Ingen horisontal scroll: table-fixed, 6 kolonner med definerte bredder.
 */
export default function ReconciliationSection({
  budgetLines,
  allProducts,
  allSubs,
  productionEntries,
  reconciliationLines,
  weeklyReportsWL,
  productionVersions,
  reconciliationStatusValue,
  canSeeValue,
  onAddProductionEntry,
  onSaveReconciliationLine: _onSaveReconciliationLine,
  onSetReconciliationStatus,
  saveProductionBatch,
}: Props) {
  const productById = useMemo(() => new Map(allProducts.map((p) => [p.id, p])), [allProducts])
  const reconByLineId = useMemo(
    () => new Map(reconciliationLines.map((r) => [r.project_budget_line_id, r])),
    [reconciliationLines],
  )

  // ── Basis-aggregering (server-state) ─────────────────────────────────────
  const baseRows = useMemo(() => {
    const approvedWRLines = weeklyReportsWL
      .filter((wr) => wr.status === 'approved' || wr.status === 'partially_approved')
      .flatMap((wr) => wr.lines.filter((l) => l.status === 'approved'))

    const ueQtyByLine = new Map<string, number>()
    for (const l of approvedWRLines) {
      ueQtyByLine.set(l.project_budget_line_id, (ueQtyByLine.get(l.project_budget_line_id) ?? 0) + l.reported_quantity)
    }
    // «Utført uten kost» = KUN egenprod/intern (executed_by ∈ internal/other).
    const noCostQtyByLine = new Map<string, number>()
    for (const e of productionEntries) {
      if (!e.project_budget_line_id) continue
      if (e.executed_by !== 'internal' && e.executed_by !== 'other') continue
      noCostQtyByLine.set(e.project_budget_line_id, (noCostQtyByLine.get(e.project_budget_line_id) ?? 0) + e.quantity)
    }

    return budgetLines.map((bl) => {
      const product = productById.get(bl.product_id)
      const planned = bl.budget_quantity
      const executedUE = ueQtyByLine.get(bl.id) ?? 0
      const executedNoCost = noCostQtyByLine.get(bl.id) ?? 0
      const price = bl.customer_price_snapshot ?? 0
      const recon = reconByLineId.get(bl.id) ?? null
      return {
        id: bl.id,
        productId: bl.product_id,
        productLabel: fmtProductLabel(product),
        unit: product?.unit ?? '–',
        planned,
        executedUE,
        executedNoCost,  // fra server-state
        price,
        recon,
      }
    })
  }, [budgetLines, productById, weeklyReportsWL, productionEntries, reconByLineId])

  // ── Sort + filter state (display only — drafts/saving use full liveRows) ──
  type SortKey = 'productLabel' | 'planned' | 'price' | 'executedUE' | 'noCost' | 'totalExecuted' | 'diffQty' | 'diffValue'
  type SortDir = 'asc' | 'desc' | null
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [filterQuery, setFilterQuery] = useState('')
  const [filterOnlyDiff, setFilterOnlyDiff] = useState(false)
  const [filterOnlyUnhandled, setFilterOnlyUnhandled] = useState(false)

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === 'asc') { setSortDir('desc') }
      else if (sortDir === 'desc') { setSortDir(null); setSortKey(null) }
      else { setSortDir('asc') }
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // ── Draft-state: egenprod-mengder, resolution og handled ─────────────────
  // Tre separate draft-maps for å holde track dirty-state rent.
  const [draftQty, setDraftQty] = useState<Record<string, string>>({})
  const [draftResolution, setDraftResolution] = useState<Record<string, string>>({})
  const [draftHandled, setDraftHandled] = useState<Record<string, boolean>>({})

  // Seed draft fra server-state ved mount og etter refetch (baseRows-endring).
  useEffect(() => {
    const initQty: Record<string, string> = {}
    const initRes: Record<string, string> = {}
    const initHandled: Record<string, boolean> = {}
    for (const r of baseRows) {
      initQty[r.id] = r.executedNoCost === 0 ? '' : String(r.executedNoCost)
      initRes[r.id] = r.recon?.resolution ?? ''
      initHandled[r.id] = r.recon?.handled ?? false
    }
    setDraftQty(initQty)
    setDraftResolution(initRes)
    setDraftHandled(initHandled)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRows])

  // ── Live-utregning fra draft ──────────────────────────────────────────────
  const liveRows = useMemo(() => {
    return baseRows.map((r) => {
      const rawQty = draftQty[r.id] ?? ''
      const noCost = rawQty === '' ? 0 : (Number(rawQty.replace(',', '.')) || 0)
      const totalExecuted = r.executedUE + noCost
      const remaining = r.planned - totalExecuted
      const diffQty = totalExecuted - r.planned
      const diffValue = diffQty * r.price
      const resolution = draftResolution[r.id] ?? (r.recon?.resolution ?? '')
      const handled = draftHandled[r.id] ?? (r.recon?.handled ?? false)
      return { ...r, noCost, totalExecuted, remaining, diffQty, diffValue, resolution, handled }
    })
  }, [baseRows, draftQty, draftResolution, draftHandled])

  // Live amber-pill: differanser som ikke er behandlet, regnet fra draft
  // ALLE rader (prosjekt-nivå) — ikke bare synlige
  const unresolvedDiffCount = liveRows.filter(
    (r) => Math.abs(r.diffQty) > 1e-9 && !r.handled,
  ).length

  // ── Visnings-liste: filtrert + sortert kopi av liveRows ──────────────────
  // Lagring, dirty-sjekk og unresolvedDiffCount bruker ALLTID hele liveRows.
  const visibleRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    let rows = liveRows.filter((r) => {
      if (q && !r.productLabel.toLowerCase().includes(q)) return false
      if (filterOnlyDiff && Math.abs(r.diffQty) <= 1e-9) return false
      if (filterOnlyUnhandled && r.handled) return false
      return true
    })
    if (sortKey && sortDir) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortKey]
        const bv = b[sortKey]
        if (av == null || bv == null) return 0
        const less = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? less : -less
      })
    }
    return rows
  }, [liveRows, filterQuery, filterOnlyDiff, filterOnlyUnhandled, sortKey, sortDir])

  // Dirty-sjekk: noen rad der draft avviker fra server-state
  const dirty = useMemo(() => {
    return baseRows.some((r) => {
      const dqRaw = draftQty[r.id] ?? ''
      const dqNum = dqRaw === '' ? 0 : (Number(dqRaw.replace(',', '.')) || 0)
      if (dqNum !== r.executedNoCost) return true
      const dr = draftResolution[r.id] ?? ''
      if (dr !== (r.recon?.resolution ?? '')) return true
      const dh = draftHandled[r.id] ?? false
      if (dh !== (r.recon?.handled ?? false)) return true
      return false
    })
  }, [baseRows, draftQty, draftResolution, draftHandled])

  // tfoot SUM-rad: summerer de SYNLIGE radene (det brukeren ser)
  const totals = useMemo(() => {
    let totalExecuted = 0
    let egenprod = 0
    let diffValue = 0
    for (const r of visibleRows) {
      totalExecuted += r.totalExecuted
      egenprod += r.noCost
      diffValue += r.diffValue
    }
    return { totalExecuted, egenprod, diffValue }
  }, [visibleRows])

  // ── Batch-lagring ─────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleBatchSave() {
    setSaveError(null)
    setSaving(true)
    // Samle ALLE linjer (batch UPSERT håndterer quantity=0 som sletting).
    const rows = liveRows.map((r) => ({
      project_budget_line_id: r.id,
      product_id: r.productId,
      unit: r.unit === '–' ? undefined : r.unit,
      quantity: r.noCost,
      resolution: r.resolution,
      handled: r.handled,
    }))
    const res = await saveProductionBatch(rows)
    setSaving(false)
    if (!res.ok) {
      setSaveError(res.error ?? 'Batch-lagring feilet')
      return
    }
    // baseRows re-seeds draftene etter fetchAll() i saveProductionBatch.
  }

  // ── Historikk-panel ───────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false)

  const productLabelByLineId = useMemo(
    () => new Map(baseRows.map((r) => [r.id, r.productLabel])),
    [baseRows],
  )

  // ── Status-arbeidsflyt ────────────────────────────────────────────────────
  const [statusError, setStatusError] = useState<string | null>(null)
  const flow = NEXT_STATUS[reconciliationStatusValue]

  // ── Registreringsskjema («Ny fri føring») ─────────────────────────────────
  const [showForm, setShowForm] = useState(false)
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formDraft, setFormDraft] = useState({
    project_budget_line_id: '',
    product_id: '',
    quantity: '',
    executed_by: 'internal' as 'subcontractor' | 'internal' | 'other',
    subcontractor_id: '',
    costMode: 'no_cost' as 'no_cost' | 'ue_cost',
    comment: '',
  })

  function pickBudgetLine(lineId: string) {
    const bl = budgetLines.find((b) => b.id === lineId)
    setFormDraft((p) => ({
      ...p,
      project_budget_line_id: lineId,
      product_id: bl?.product_id ?? p.product_id,
    }))
  }

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!formDraft.product_id) { setFormError('Velg et produkt.'); return }
    const qty = Number(formDraft.quantity.replace(',', '.'))
    if (!Number.isFinite(qty)) { setFormError('Mengde må være et gyldig tall.'); return }
    if (formDraft.executed_by === 'subcontractor' && !formDraft.subcontractor_id) {
      setFormError('Velg underentreprenør når «utført av» er underentreprenør.'); return
    }
    const bl = formDraft.project_budget_line_id
      ? budgetLines.find((b) => b.id === formDraft.project_budget_line_id)
      : null
    const product = productById.get(formDraft.product_id)
    setFormSaving(true)
    const cost =
      formDraft.executed_by === 'subcontractor' && formDraft.costMode === 'ue_cost' && bl
        ? qty * (bl.subcontractor_cost_price_snapshot ?? 0)
        : 0
    const res = await onAddProductionEntry({
      product_id: formDraft.product_id,
      quantity: qty,
      project_budget_line_id: formDraft.project_budget_line_id || null,
      unit: product?.unit ?? 'stk',
      executed_by: formDraft.executed_by,
      subcontractor_id: formDraft.executed_by === 'subcontractor' ? formDraft.subcontractor_id : null,
      cost,
      comment: formDraft.comment,
    })
    setFormSaving(false)
    if (!res.ok) { setFormError(res.error ?? 'Lagring feilet'); return }
    setFormDraft((p) => ({ ...p, quantity: '', comment: '' }))
    setShowForm(false)
  }

  const subProduct = formDraft.executed_by === 'subcontractor'

  return (
    <div className="space-y-6">
      {/* ── (c) Status-arbeidsflyt ─────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Avstemming mot kunde</h2>
            <StatusPill meta={reconciliationStatus(reconciliationStatusValue)} />
          </div>
          <div className="flex items-center gap-2">
            {flow && (
              <button
                type="button"
                onClick={async () => {
                  const res = await onSetReconciliationStatus(flow.next)
                  if (!res.ok) setStatusError(res.error ?? 'Kunne ikke endre status')
                }}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {flow.label}
              </button>
            )}
            {(reconciliationStatusValue === 'reconciled' || reconciliationStatusValue === 'ready_for_final_check') && (
              <select
                value={reconciliationStatusValue}
                onChange={async (e) => {
                  const res = await onSetReconciliationStatus(e.target.value as ReconciliationStatus)
                  if (!res.ok) setStatusError(res.error ?? 'Kunne ikke endre status')
                }}
                className="px-2 py-1.5 text-sm border border-border rounded bg-card text-[var(--color-text-secondary)]"
                aria-label="Endre avstemmingsstatus"
              >
                {(Object.keys(RECONCILIATION_STATUSES) as ReconciliationStatus[])
                  .filter((s) => s !== 'closed')
                  .map((s) => (
                    <option key={s} value={s}>{RECONCILIATION_STATUSES[s].label}</option>
                  ))}
              </select>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Avstem planlagt mot faktisk utført per budsjettlinje før prosjektet lukkes mot kunde.
          Prosjektet kan først fullføres når statusen er «Avstemt».
        </p>
      </Card>

      {statusError && <ErrorBox>{statusError}</ErrorBox>}

      {/* ── (a) Regneark-grid per budsjettlinje ───────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Avstemming per budsjettlinje</h3>
          <div className="flex items-center gap-2 flex-wrap">
            {unresolvedDiffCount > 0 && (
              <StatusPill tone="amber">
                {unresolvedDiffCount} ubehandlet differanse{unresolvedDiffCount === 1 ? '' : 'r'}
              </StatusPill>
            )}
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="text-xs text-primary hover:underline"
            >
              {showHistory ? 'Skjul historikk' : 'Vis endringer'}
            </button>
          </div>
        </div>

        {saveError && <ErrorBox>{saveError}</ErrorBox>}

        {/* Dirty-varsel */}
        {dirty && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
            Du har ulagrede endringer
          </p>
        )}

        {/* ── Filter-verktøylinje ──────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Søk produkt…"
            className="w-full max-w-xs px-3 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-[var(--color-text-primary)]"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filterOnlyDiff}
              onChange={(e) => setFilterOnlyDiff(e.target.checked)}
              className="rounded"
            />
            Vis bare avvik
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filterOnlyUnhandled}
              onChange={(e) => setFilterOnlyUnhandled(e.target.checked)}
              className="rounded"
            />
            Vis bare ubehandlet
          </label>
          {(filterQuery || filterOnlyDiff || filterOnlyUnhandled) && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {visibleRows.length} / {liveRows.length} rader
            </span>
          )}
        </div>

        <Card className="overflow-hidden">
          {/* table-fixed + colgroup gir stabile kolonnebredder uten overflow-x-auto.
              canSeeValue=true → 9 kolonner; false → 7 kolonner. */}
          <table className="w-full text-sm table-fixed border-collapse border border-border [&_th]:border [&_th]:border-border [&_td]:border [&_td]:border-border">
            <colgroup>
              {/* 1 Produkt */}
              <col style={{ width: canSeeValue ? '22%' : '28%' }} />
              {/* 2 Planlagt */}
              <col style={{ width: canSeeValue ? '9%' : '11%' }} />
              {/* 3 Pris/stk — kun canSeeValue */}
              {canSeeValue && <col style={{ width: '10%' }} />}
              {/* 4 UE utført */}
              <col style={{ width: canSeeValue ? '9%' : '11%' }} />
              {/* 5 Egenprod */}
              <col style={{ width: canSeeValue ? '9%' : '11%' }} />
              {/* 6 Totalt */}
              <col style={{ width: canSeeValue ? '9%' : '11%' }} />
              {/* 7 Differanse */}
              <col style={{ width: canSeeValue ? '9%' : '11%' }} />
              {/* 8 Diff kr — kun canSeeValue */}
              {canSeeValue && <col style={{ width: '10%' }} />}
              {/* 9 Kommentar + behandlet */}
              <col style={{ width: canSeeValue ? '13%' : '17%' }} />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-muted">
                {/* Sortable header helper: renders label + sort indicator */}
                {(
                  [
                    { key: 'productLabel' as SortKey, label: 'Produkt', align: 'left' },
                    { key: 'planned' as SortKey, label: 'Planlagt', align: 'right' },
                    ...(canSeeValue ? [{ key: 'price' as SortKey, label: 'Pris/stk', align: 'right' as const }] : []),
                    { key: 'executedUE' as SortKey, label: 'UE utført', align: 'right' },
                    { key: 'noCost' as SortKey, label: 'Egenprod', align: 'right' },
                    { key: 'totalExecuted' as SortKey, label: 'Totalt', align: 'right' },
                    { key: 'diffQty' as SortKey, label: 'Diff', align: 'right' },
                    ...(canSeeValue ? [{ key: 'diffValue' as SortKey, label: 'Diff kr', align: 'right' as const }] : []),
                  ] as { key: SortKey; label: string; align: 'left' | 'right' }[]
                ).map((col) => {
                  const active = sortKey === col.key
                  return (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`px-3 py-2 text-${col.align} text-xs font-medium uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}
                    >
                      <span className="inline-flex items-center gap-0.5 justify-end">
                        {col.label}
                        {active && sortDir === 'asc' && <ChevronUp size={11} className="shrink-0" />}
                        {active && sortDir === 'desc' && <ChevronDown size={11} className="shrink-0" />}
                      </span>
                    </th>
                  )
                })}
                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                  Kommentar
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td
                    colSpan={canSeeValue ? 9 : 7}
                    className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)]"
                  >
                    {liveRows.length === 0
                      ? 'Ingen budsjettlinjer å avstemme.'
                      : 'Ingen rader matcher filteret.'}
                  </td>
                </tr>
              )}
              {visibleRows.map((r, rowIdx) => {
                const hasDiff = Math.abs(r.diffQty) > 1e-9
                const diffColor = hasDiff
                  ? r.diffQty > 0
                    ? 'text-orange-600 font-medium'
                    : 'text-red-600 font-medium'
                  : 'text-[var(--color-text-muted)]'
                const diffValueColor = hasDiff
                  ? r.diffValue >= 0
                    ? 'text-green-600'
                    : 'text-red-600'
                  : 'text-[var(--color-text-muted)]'

                return (
                  <tr key={r.id} className="align-middle even:bg-muted/30 hover:bg-blue-50/50">
                    {/* (1) Produkt — navn + enhet som liten suffiks */}
                    <td className="px-3 py-1.5">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="truncate text-xs text-[var(--color-text-primary)]">{r.productLabel}</span>
                        <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">{r.unit}</span>
                      </div>
                    </td>

                    {/* (2) Planlagt — KUN mengde */}
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <span className="font-medium text-[var(--color-text-primary)]">{r.planned}</span>
                    </td>

                    {/* (3) Pris/stk — kun canSeeValue */}
                    {canSeeValue && (
                      <td className="px-3 py-1.5 text-right tabular-nums text-[var(--color-text-muted)]">
                        {fmt(r.price)}
                      </td>
                    )}

                    {/* (4) UE utført — egen kolonne */}
                    <td className="px-3 py-1.5 text-right tabular-nums text-[var(--color-text-primary)]">
                      {r.executedUE}
                    </td>

                    {/* (5) Egenprod — redigerbar, kantløs input med lys bakgrunn */}
                    <td className="p-0 bg-blue-50/40">
                      <NumberInput
                        value={draftQty[r.id] ?? ''}
                        onChange={(raw) =>
                          setDraftQty((prev) => ({ ...prev, [r.id]: raw }))
                        }
                        placeholder="0"
                        tabIndex={rowIdx + 1}
                        className="w-full h-full px-2 py-1.5 text-sm text-right tabular-nums border-0 bg-transparent rounded-none focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary text-[var(--color-text-primary)]"
                        aria-label={`Egenprod for ${r.productLabel}`}
                      />
                    </td>

                    {/* (6) Totalt utført */}
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[var(--color-text-primary)]">
                      {r.totalExecuted}
                    </td>

                    {/* (7) Differanse mengde */}
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <span className={diffColor}>
                        {hasDiff ? (r.diffQty > 0 ? '+' : '') : ''}
                        {r.diffQty}
                      </span>
                    </td>

                    {/* (8) Diff kr — kun canSeeValue */}
                    {canSeeValue && (
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        <span className={diffValueColor}>{fmt(r.diffValue)}</span>
                      </td>
                    )}

                    {/* (9) Kommentar + behandlet */}
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={draftResolution[r.id] ?? ''}
                          onChange={(e) =>
                            setDraftResolution((prev) => ({ ...prev, [r.id]: e.target.value }))
                          }
                          placeholder="Kommentar…"
                          className="flex-1 min-w-0 px-1.5 py-1 text-xs border-0 bg-transparent rounded focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary text-[var(--color-text-primary)]"
                        />
                        <label className="inline-flex items-center gap-1 text-xs cursor-pointer shrink-0" title={(draftHandled[r.id] ?? false) ? 'Behandlet' : 'Åpen'}>
                          <input
                            type="checkbox"
                            checked={draftHandled[r.id] ?? false}
                            onChange={(e) =>
                              setDraftHandled((prev) => ({ ...prev, [r.id]: e.target.checked }))
                            }
                          />
                          <span className={(draftHandled[r.id] ?? false) ? 'text-green-700' : 'text-[var(--color-text-muted)]'}>
                            {(draftHandled[r.id] ?? false) ? 'OK' : 'Åpen'}
                          </span>
                        </label>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {liveRows.length > 0 && (
              <tfoot>
                {/* canSeeValue=true: 9 celler; false: 7 celler */}
                <tr className="border-t border-border bg-muted">
                  {/* (1) Produkt */}
                  <td className="px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)]">
                    Sum
                  </td>
                  {/* (2) Planlagt — tom */}
                  <td />
                  {/* (3) Pris/stk — tom, kun canSeeValue */}
                  {canSeeValue && <td />}
                  {/* (4) UE utført — Σ synlige rader */}
                  <td className="px-3 py-2 text-right tabular-nums text-sm font-semibold text-[var(--color-text-primary)]">
                    {visibleRows.reduce((s, r) => s + r.executedUE, 0)}
                  </td>
                  {/* (5) Egenprod — Σ */}
                  <td className="px-3 py-2 text-right tabular-nums text-sm font-semibold text-[var(--color-text-primary)]">
                    {totals.egenprod}
                  </td>
                  {/* (6) Totalt — Σ */}
                  <td className="px-3 py-2 text-right tabular-nums text-sm font-semibold text-[var(--color-text-primary)]">
                    {totals.totalExecuted}
                  </td>
                  {/* (7) Diff mengde — tom */}
                  <td />
                  {/* (8) Diff kr — Σ, kun canSeeValue */}
                  {canSeeValue && (
                    <td className="px-3 py-2 text-right tabular-nums text-sm font-semibold">
                      <span className={totals.diffValue >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {fmt(totals.diffValue)}
                      </span>
                    </td>
                  )}
                  {/* (9) Kommentar — N å avklare */}
                  <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                    {unresolvedDiffCount > 0 ? `${unresolvedDiffCount} å avklare` : '–'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </Card>

        {/* Lagre-knapp + dirty-indikator */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="primary"
            disabled={saving || !dirty}
            onClick={handleBatchSave}
          >
            {saving ? 'Lagrer…' : 'Lagre'}
          </Button>
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => {
              // Reset til server-state
              const initQty: Record<string, string> = {}
              const initRes: Record<string, string> = {}
              const initHandled: Record<string, boolean> = {}
              for (const r of baseRows) {
                initQty[r.id] = r.executedNoCost === 0 ? '' : String(r.executedNoCost)
                initRes[r.id] = r.recon?.resolution ?? ''
                initHandled[r.id] = r.recon?.handled ?? false
              }
              setDraftQty(initQty)
              setDraftResolution(initRes)
              setDraftHandled(initHandled)
            }}
            className="text-sm text-[var(--color-text-secondary)] hover:underline disabled:opacity-40"
          >
            Forkast endringer
          </button>
        </div>

        <p className="text-xs text-[var(--color-text-muted)]">
          «Egenprod» = egenproduksjon/intern (teller ikke som UE-kost). «Utført UE» = godkjente ukesrapport-linjer.
          Differanser bør kommenteres og hukes som behandlet før prosjektet markeres avstemt.
        </p>
      </section>

      {/* ── Historikk-panel ───────────────────────────────────────────────── */}
      {showHistory && (
        <ProductionHistory
          versions={productionVersions}
          productLabelByLineId={productLabelByLineId}
        />
      )}

      {/* ── (b) Sekundær: Registrer fri produksjonsføring ─────────────────── */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Ny fri føring</h3>
          {!showForm && (
            <button
              type="button"
              onClick={() => { setShowForm(true); setFormError(null) }}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Plus size={14} /> Legg til
            </button>
          )}
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          Produksjonsføringer uten budsjettlinje, eller med ordinær UE-kost. Brukes unntaksvis.
        </p>

        {showForm && (
          <form onSubmit={submitEntry} className="mt-4 pt-4 border-t border-border space-y-4">
            {formError && <ErrorBox>{formError}</ErrorBox>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Budsjettlinje (valgfri)">
                <Select value={formDraft.project_budget_line_id} onChange={(e) => pickBudgetLine(e.target.value)}>
                  <option value="">— Ingen / fri føring —</option>
                  {budgetLines.map((bl) => (
                    <option key={bl.id} value={bl.id}>{fmtProductLabel(productById.get(bl.product_id))}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Produkt">
                <Select
                  value={formDraft.product_id}
                  onChange={(e) => setFormDraft((p) => ({ ...p, product_id: e.target.value }))}
                  required
                >
                  <option value="">— Velg produkt —</option>
                  {allProducts.map((p) => (
                    <option key={p.id} value={p.id}>{fmtProductLabel(p)}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Mengde">
                <NumberInput
                  required
                  value={formDraft.quantity}
                  onChange={(raw) => setFormDraft((p) => ({ ...p, quantity: raw }))}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
                />
              </Field>
              <Field label="Utført av">
                <Select
                  value={formDraft.executed_by}
                  onChange={(e) =>
                    setFormDraft((p) => ({
                      ...p,
                      executed_by: e.target.value as typeof p.executed_by,
                      costMode: 'no_cost',
                    }))
                  }
                >
                  <option value="internal">Egenproduksjon</option>
                  <option value="other">Annet</option>
                  <option value="subcontractor">Underentreprenør</option>
                </Select>
              </Field>
              {subProduct && (
                <Field label="Underentreprenør">
                  <Select
                    value={formDraft.subcontractor_id}
                    onChange={(e) => setFormDraft((p) => ({ ...p, subcontractor_id: e.target.value }))}
                    required
                  >
                    <option value="">— Velg UE —</option>
                    {allSubs.map((s) => (
                      <option key={s.id} value={s.id}>{s.company_name}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Kost">
                {subProduct ? (
                  <Select
                    value={formDraft.costMode}
                    onChange={(e) => setFormDraft((p) => ({ ...p, costMode: e.target.value as typeof p.costMode }))}
                  >
                    <option value="no_cost">0 kr</option>
                    <option value="ue_cost">Ordinær UE-kost</option>
                  </Select>
                ) : (
                  <div className="px-3 py-2 text-sm text-[var(--color-text-muted)] border border-border rounded-lg bg-muted">
                    0 kr
                  </div>
                )}
              </Field>
              <Field label="Kommentar" className="sm:col-span-2 lg:col-span-3">
                <input
                  type="text"
                  value={formDraft.comment}
                  onChange={(e) => setFormDraft((p) => ({ ...p, comment: e.target.value }))}
                  placeholder="Valgfri kommentar"
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
                />
              </Field>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={formSaving}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {formSaving ? 'Lagrer…' : 'Registrer føring'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError(null) }}
                className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:underline"
              >
                Avbryt
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  )
}
