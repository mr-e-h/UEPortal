'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Download, Plus, Trash2, Check } from 'lucide-react'
import type { Project } from '@/types'
import { fmtNOK as fmt, fmtNumber, parseNorwegianNumber } from '@/lib/format'
import { readyToInvoice } from '@/lib/economy'
import { useMe } from '@/lib/useMe'
import { useConfirm } from '@/components/ui/useConfirm'
import Field from '@/components/ui/Field'
import Card from '@/components/ui/Card'
import StatusPill from '@/components/ui/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import NumberInput from '@/components/NumberInput'

const fmtQty = (n: number) => fmtNumber(n, 2)

type LineItem = {
  report_line_id?: string
  change_order_id?: string
  project_id: string
  project_name: string
  product_name: string
  unit: string
  quantity: number
  cost_price: number
  cost_total: number
  date: string
  source: 'report' | 'change_order'
  // Billed status (4.7 / #10). null = not yet invoiced. Report lines AND
  // change-order lines now both carry their real status (CO billed columns
  // added in migration 0017).
  billed_at: string | null
  ue_invoice_id: string | null
}

// #10: a single selection set spans both report lines (report_line_id) and
// change-order lines (change_order_id). The id spaces are different tables and
// could in principle collide, so we tag each key with its source and split it
// back into line_ids[] / co_ids[] when posting. lineKey() returns null for a
// line that has no selectable id.
type SelKey = `report:${string}` | `co:${string}`
function lineKey(l: LineItem): SelKey | null {
  if (l.source === 'report' && l.report_line_id) return `report:${l.report_line_id}`
  if (l.source === 'change_order' && l.change_order_id) return `co:${l.change_order_id}`
  return null
}

type Summary = {
  line_count: number
  total_cost: number
}

type UEInvoice = {
  id: string
  subcontractor_id: string
  project_id: string | null
  amount: number
  invoice_date: string
  note: string
  created_at: string
}

export default function UEInvoiceBasisPage() {
  const { me } = useMe()
  const { confirm: confirmAction, confirmDialog } = useConfirm()
  const subId = me?.subcontractor_id ?? ''
  const [projects, setProjects] = useState<Project[]>([])
  const [lines, setLines] = useState<LineItem[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [invoices, setInvoices] = useState<UEInvoice[]>([])

  const [projectFilter, setProjectFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  // 4.7: «Skjul fakturerte» er en ren klient-side visnings-filtrering
  // (displayLines). Grunnlaget hentes alltid fullt — summene over påvirkes aldri.
  const [hideBilled, setHideBilled] = useState(false)
  // 4.7 / #10: per-line selection for «Fakturer valgte». Keyed by SelKey so the
  // set can hold both report lines and change-order lines unambiguously.
  const [selectedLines, setSelectedLines] = useState<Set<SelKey>>(new Set())
  const [billingLines, setBillingLines] = useState(false)

  // Invoice form state
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])
  const [invoiceNote, setInvoiceNote] = useState('')
  // 4.3: no «Alle prosjekter» default — UE must pick a project so the invoice
  // is scoped and counts in the per-project «Gjenstår».
  const [invoiceProjectId, setInvoiceProjectId] = useState('')
  const [savingInvoice, setSavingInvoice] = useState(false)
  // 4.2 / 4.3: red banner for save/delete/billing failures + missing project.
  const [invError, setInvError] = useState<string | null>(null)

  useEffect(() => {
    if (!subId) return
    fetch(`/api/subcontractor/projects?subcontractor_id=${subId}`)
      .then((r) => r.json())
      .then((data) => setProjects(Array.isArray(data) ? data : []))
  }, [subId])

  const fetchBasis = useCallback(async () => {
    if (!subId) return
    setLoading(true)
    const params = new URLSearchParams({ subcontractor_id: subId })
    if (projectFilter !== 'all') params.set('project_id', projectFilter)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    // NB: «Skjul fakturerte» filtreres KUN klient-side (displayLines). Grunnlaget
    // hentes alltid fullt, slik at «Gjenstår å fakturere» (godkjent − fakturert)
    // ikke dobbelt-trekker de fakturerte linjene.

    const data = await fetch(`/api/subcontractor/invoice-basis?${params}`).then((r) => r.json())
    setLines(data.lines ?? [])
    setSummary(data.summary ?? null)
    // Prune any selection that no longer matches a visible line.
    setSelectedLines((prev) => {
      const visible = new Set<SelKey>(
        (data.lines ?? []).map((l: LineItem) => lineKey(l)).filter(Boolean) as SelKey[],
      )
      const next = new Set<SelKey>()
      prev.forEach((k) => { if (visible.has(k)) next.add(k) })
      return next
    })
    setLoading(false)
  }, [subId, projectFilter, dateFrom, dateTo])

  const fetchInvoices = useCallback(async () => {
    if (!subId) return
    const params = new URLSearchParams({ subcontractor_id: subId })
    if (projectFilter !== 'all') params.set('project_id', projectFilter)
    // 4.1 (BUG): scope registered invoices to the same date window as the basis,
    // otherwise a date-filtered «Gjenstår å fakturere» compares a windowed basis
    // against ALL invoices and goes negative/red without reason.
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    const data = await fetch(`/api/subcontractor/ue-invoices?${params}`).then((r) => r.json())
    setInvoices(Array.isArray(data) ? data : [])
  }, [subId, projectFilter, dateFrom, dateTo])

  useEffect(() => {
    if (subId) {
      fetchBasis()
      fetchInvoices()
    }
  }, [fetchBasis, fetchInvoices, subId])

  async function registerInvoice() {
    setInvError(null)
    // 4.3: a project must be chosen so the invoice is scoped and counts in the
    // per-project «Gjenstår». Inline error, reuse the same banner as 4.2.
    if (!invoiceProjectId) {
      setInvError('Velg et prosjekt før du registrerer fakturaen.')
      return
    }
    // 4.5: parse the thousand-separated input with the shared Norwegian parser.
    const amt = parseNorwegianNumber(invoiceAmount)
    if (!subId || amt <= 0) {
      setInvError('Skriv inn et gyldig beløp.')
      return
    }
    setSavingInvoice(true)
    const res = await fetch('/api/subcontractor/ue-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subcontractor_id: subId,
        project_id: invoiceProjectId,
        amount: amt,
        invoice_date: invoiceDate,
        note: invoiceNote,
      }),
    })
    setSavingInvoice(false)
    // 4.2: surface failures and DO NOT clear the fields, so the UE can retry.
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }))
      setInvError(d.error ?? 'Kunne ikke lagre fakturaen. Prøv igjen.')
      return
    }
    setInvoiceAmount('')
    setInvoiceNote('')
    await fetchInvoices()
  }

  async function deleteInvoice(id: string) {
    if (!(await confirmAction({ title: 'Slett fakturaregistrering?', message: 'Registreringen fjernes og «Gjenstår å fakturere» oppdateres.', confirmLabel: 'Slett' }))) return
    setInvError(null)
    const res = await fetch(`/api/subcontractor/ue-invoices?id=${id}&subcontractor_id=${subId}`, { method: 'DELETE' })
    // 4.2: same error-surfacing on delete.
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }))
      setInvError(d.error ?? 'Kunne ikke slette fakturaregistreringen. Prøv igjen.')
      return
    }
    // Un-billing on the server reopens the lines, so refresh the basis too.
    await Promise.all([fetchInvoices(), fetchBasis()])
  }

  // 4.7: register an invoice for the picked lines and mark them billed. The sum
  // of the selected cost totals is used as the amount, so the registered figure
  // is an exact reconciliation of the chosen lines (never a re-typed number).
  async function billSelected() {
    setInvError(null)
    if (selectedLines.size === 0) return
    // The selected lines themselves (report lines AND change-order lines).
    const chosen = lines.filter((l) => {
      const k = lineKey(l)
      return k !== null && selectedLines.has(k)
    })
    // Kryss-prosjekt-vern (defense-in-depth): #1 lar bare linjer velges når ett
    // konkret prosjekt er filtrert, så utvalget hører normalt til ÉTT prosjekt.
    // Vi utleder likevel prosjektet fra linjene selv (ikke fra «Registrer
    // faktura»-velgeren) og avviser et blandet utvalg, så beløpet aldri havner
    // på feil prosjekt og per-prosjekt «Gjenstår» ikke spriker.
    const billProjects = new Set(chosen.map((l) => l.project_id))
    if (billProjects.size !== 1) {
      setInvError('Du kan bare fakturere linjer fra ett prosjekt om gangen. Filtrer på ett prosjekt, eller velg linjer som hører til samme prosjekt.')
      return
    }
    const billProjectId = Array.from(billProjects)[0]
    // #10: split the selection into report-line ids and change-order ids so the
    // POST marks both kinds billed (server validates ownership + project per id).
    const lineIds = chosen
      .filter((l) => l.source === 'report' && l.report_line_id)
      .map((l) => l.report_line_id!)
    const coIds = chosen
      .filter((l) => l.source === 'change_order' && l.change_order_id)
      .map((l) => l.change_order_id!)
    setBillingLines(true)
    const res = await fetch('/api/subcontractor/ue-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subcontractor_id: subId,
        project_id: billProjectId,
        amount: selectedTotal,
        invoice_date: invoiceDate,
        note: invoiceNote,
        line_ids: lineIds,
        co_ids: coIds,
      }),
    })
    setBillingLines(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }))
      setInvError(d.error ?? 'Kunne ikke fakturere de valgte linjene. Prøv igjen.')
      return
    }
    setSelectedLines(new Set())
    setInvoiceNote('')
    await Promise.all([fetchInvoices(), fetchBasis()])
  }

  function toggleLine(key: SelKey) {
    setSelectedLines((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function exportCSV() {
    const header = ['Prosjekt', 'Produkt', 'Enhet', 'Mengde', 'Kostpris', 'Sum kostnad', 'Dato', 'Kilde']
    const rows = lines.map((l) => [
      l.project_name,
      l.product_name,
      l.unit,
      fmtQty(l.quantity),
      l.cost_price.toFixed(2),
      l.cost_total.toFixed(2),
      l.date,
      l.source === 'report' ? 'Rapport' : 'Endringsmelding',
    ])
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fakturagrunnlag_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalApproved = summary?.total_cost ?? 0
  const totalInvoiced = invoices.reduce((s, inv) => s + inv.amount, 0)
  // #7: «Gjenstår å fakturere» via den delte formelen. summary.total_cost folder
  // allerede inn både godkjente rapportlinjer og godkjente EM-er (UE-kost), så
  // hele godkjent-kosten går inn som approvedWork; EM-leddet er 0 her.
  const totalRemaining = readyToInvoice({
    approvedWork: totalApproved,
    approvedChangeOrders: 0,
    invoiced: totalInvoiced,
  })

  // #2: et datofilter trekker grunnlaget på arbeidets submitted_at, men
  // fakturaene på invoice_date — to forskjellige dato-akser. «Gjenstår» (og
  // per-linje-fakturering) blir derfor misvisende så snart en dato er satt.
  // Vi skjuler/grår dem da, men beholder «Godkjent total» og «Fakturert».
  const dateFilterActive = !!(dateFrom || dateTo)

  // #1: linje-valg og per-linje-fakturering gir bare mening når ETT konkret
  // prosjekt er filtrert. Med «Alle prosjekter» ville «velg alle»/«Fakturer
  // valgte» spenne over flere prosjekter, mens fakturaen må tagges til ett →
  // felle. Tillat derfor linje-valg kun for ett prosjekt og uten datofilter (#2).
  const canBillLines = projectFilter !== 'all' && !dateFilterActive

  // #1/#2: når linje-fakturering ikke lenger er tillatt (bytte til «Alle
  // prosjekter» eller satt datofilter), nullstill et eventuelt utvalg så et
  // gjemt valg ikke kan faktureres på feil scope.
  useEffect(() => {
    if (!canBillLines) setSelectedLines((prev) => (prev.size ? new Set() : prev))
  }, [canBillLines])

  // #1: avkrysningskolonnen vises kun når linje-fakturering er tillatt.
  // colSpan-verdiene for laster/tom/footer følger med så tabellen ikke sprekker.
  const fullColSpan = canBillLines ? 9 : 8
  const footerLeadSpan = canBillLines ? 5 : 4

  // 4.7: «Skjul fakturerte» er ren visnings-filtrering — påvirker ALDRI summene
  // over (de bygger på det fulle grunnlaget), kun hvilke rader tabellen viser.
  const displayLines = useMemo(
    () => (hideBilled ? lines.filter((l) => !l.billed_at) : lines),
    [lines, hideBilled],
  )

  // 4.7 / #10: any not-yet-billed line — report line OR change-order line — can
  // be selected. Both kinds now carry a real billed_at (CO billed columns added
  // in migration 0017) and a selectable id (lineKey).
  // #1/#2: and only when a single project is filtered (no date filter), so
  // line-billing never spans projects or mixes date axes.
  const selectableLines = useMemo(
    () => (canBillLines ? lines.filter((l) => lineKey(l) !== null && !l.billed_at) : []),
    [lines, canBillLines],
  )
  const selectedTotal = useMemo(
    () => lines
      .filter((l) => {
        const k = lineKey(l)
        return k !== null && selectedLines.has(k)
      })
      .reduce((s, l) => s + l.cost_total, 0),
    [lines, selectedLines],
  )
  const allSelectableChosen =
    selectableLines.length > 0 && selectableLines.every((l) => selectedLines.has(lineKey(l)!))

  function toggleAll() {
    setSelectedLines((prev) => {
      if (allSelectableChosen) return new Set()
      const next = new Set(prev)
      selectableLines.forEach((l) => next.add(lineKey(l)!))
      return next
    })
  }

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Fakturering</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Tilgjengelig for fakturering — godkjent arbeid minus det du allerede har fakturert
          </p>
        </div>
        <button
          onClick={exportCSV}
          disabled={lines.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-[var(--color-text-secondary)] text-sm rounded-lg hover:bg-muted disabled:opacity-40"
        >
          <Download size={14} />
          Eksporter CSV
        </button>
      </div>

      {/* 4.2/4.3: red error banner for save/delete/billing failures + validation */}
      {invError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{invError}</p>
      )}

      {/* Filters */}
      <Card className="p-4 flex flex-wrap gap-4 items-end">
        <Field label="Prosjekt">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-card text-[var(--color-text-primary)]"
          >
            <option value="all">Alle prosjekter</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Fra dato">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-card text-[var(--color-text-primary)]"
          />
        </Field>
        <Field label="Til dato">
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-card text-[var(--color-text-primary)]"
          />
        </Field>
      </Card>

      {/* Financial summary — «Gjenstår» er helten og står først;
          linjeantall-kortet var støy og er fjernet. */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* #2: med datofilter måles grunnlaget på arbeidets submitted_at og
              fakturaene på invoice_date — to akser som ikke kan trekkes fra
              hverandre. Grå ut «Gjenstår» med en kort forklaring i stedet for å
              vise et villedende tall. «Godkjent total» og «Fakturert» står. */}
          {dateFilterActive ? (
            <Card className="p-4 bg-muted/40">
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Gjenstår å fakturere</p>
              <p className="text-2xl font-bold mt-1 text-[var(--color-text-muted)]">–</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Skjult med datofilter — grunnlaget filtreres på arbeidsdato og fakturaene på fakturadato, så differansen blir ikke sammenliknbar. Fjern datofilteret for å se gjenstående.
              </p>
            </Card>
          ) : (
            <Card className={`p-4 ${totalRemaining < 0 ? 'border-red-200 bg-red-50' : ''}`}>
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Gjenstår å fakturere</p>
              <p className={`text-2xl font-bold mt-1 ${totalRemaining < 0 ? 'text-red-600' : totalRemaining === 0 ? 'text-green-600' : 'text-[var(--color-text-primary)]'}`}>
                {fmt(totalRemaining)}
              </p>
            </Card>
          )}
          <Card className="p-4">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Godkjent total</p>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{fmt(totalApproved)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Fakturert</p>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{fmt(totalInvoiced)}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{invoices.length} faktura{invoices.length !== 1 ? 'er' : ''}</p>
          </Card>
        </div>
      )}

      {/* Register invoice — #9/#10: dette er engangs-/samlebeløp-veien. Den
          merker INGEN linjer som fakturert, så bruk den til à konto / samlebeløp.
          For å fakturere konkrete linjer presist — rapport- ELLER EM-/CO-linjer —
          bruk «Fakturer valgte linjer» i tabellen under, så de merkes fakturert
          og samme arbeid ikke kan faktureres to ganger. */}
      <Card className="p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Registrer faktura (samlebeløp / à konto)</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Et fritt beløp som ikke knyttes til enkeltlinjer — for à konto eller samlefaktura. Vil du fakturere bestemte linjer (rapport eller EM), bruk «Fakturer valgte linjer» i tabellen under, så de ikke kan faktureres på nytt.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <Field label="Beløp (NOK)">
            {/* 4.5: tusenskille mens UE skriver (NumberInput), parses med
                parseNorwegianNumber ved lagring. */}
            <NumberInput
              inputMode="numeric"
              placeholder="0"
              value={invoiceAmount}
              onChange={setInvoiceAmount}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-white text-[var(--color-text-primary)]"
            />
            {/* 4.4: «Fyll inn gjenstående» — synk med prosjektfilteret (gjenstår
                speiler det aktive scopet). Skjult når ingenting gjenstår, eller
                med datofilter (#2) der «Gjenstår» ikke er sammenliknbart. */}
            {!dateFilterActive && totalRemaining > 0 && (
              <button
                type="button"
                onClick={() => setInvoiceAmount(String(Math.round(totalRemaining)))}
                className="mt-1 text-xs text-primary hover:underline"
              >
                Fyll inn gjenstående ({fmt(totalRemaining)})
              </button>
            )}
          </Field>
          <Field label="Fakturadato">
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-white text-[var(--color-text-primary)]"
            />
          </Field>
          <Field label="Prosjekt">
            {/* 4.3: ingen «Alle prosjekter»-default — UE må velge prosjekt. */}
            <select
              value={invoiceProjectId}
              onChange={(e) => setInvoiceProjectId(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-white text-[var(--color-text-primary)]"
            >
              <option value="">Velg prosjekt…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Notat (valgfritt)">
            <input
              type="text"
              placeholder="Fakturanr. eller merknad"
              value={invoiceNote}
              onChange={(e) => setInvoiceNote(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-white text-[var(--color-text-primary)]"
            />
          </Field>
        </div>
        <Button
          onClick={registerInvoice}
          disabled={savingInvoice || parseNorwegianNumber(invoiceAmount) <= 0}
          className="inline-flex items-center gap-1.5"
        >
          <Plus size={14} />
          {savingInvoice ? 'Lagrer...' : 'Registrer faktura'}
        </Button>
      </Card>

      {/* Invoice history */}
      {invoices.length > 0 && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Fakturert — historikk</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted border-b border-border">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Dato</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Prosjekt</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Notat</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Beløp</th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody>
              {[...invoices].sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)).map((inv) => {
                const proj = projects.find((p) => p.id === inv.project_id)
                return (
                  <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5 text-[var(--color-text-secondary)] whitespace-nowrap">{inv.invoice_date}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{proj?.name ?? 'Alle prosjekter'}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{inv.note || '–'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-blue-600">{fmt(inv.amount)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => deleteInvoice(inv.id)}
                        className="p-1 text-[var(--color-text-muted)] hover:text-red-600 transition-colors"
                        title="Slett"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted border-t border-border">
                <td colSpan={3} className="px-4 py-2.5 text-sm font-medium text-[var(--color-text-secondary)]">Totalt fakturert</td>
                <td className="px-4 py-2.5 text-right font-bold text-blue-600">{fmt(totalInvoiced)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Approved lines table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Godkjente linjer</h2>
            {/* 4.7: sum av valgte linjer som hjelp til beløp. */}
            {selectedLines.size > 0 && (
              <span className="text-xs text-[var(--color-text-muted)]">
                {selectedLines.size} valgt · <span className="font-semibold text-[var(--color-text-primary)]">{fmt(selectedTotal)}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* 4.7: «Skjul fakturerte» — ren klient-side visnings-filtrering. */}
            <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideBilled}
                onChange={(e) => setHideBilled(e.target.checked)}
                className="rounded border-border"
              />
              Skjul fakturerte
            </label>
            {/* #9/#10: «Fakturer valgte linjer» — den presise per-linje-veien for
                både rapport- og EM-/CO-linjer. Sender line_ids + co_ids og merker
                dem fakturert, så samme arbeid ikke kan faktureres på nytt. Vises
                kun når linje-valg er tillatt (ett prosjekt, uten datofilter). */}
            {canBillLines && selectedLines.size > 0 && (
              <Button
                onClick={billSelected}
                disabled={billingLines}
                className="inline-flex items-center gap-1.5 py-1.5"
              >
                <Check size={14} />
                {billingLines ? 'Fakturerer...' : `Fakturer valgte linjer (${fmt(selectedTotal)})`}
              </Button>
            )}
          </div>
        </div>
        {/* #1: linje-fakturering krever ett konkret prosjekt (og intet datofilter,
            #2). Forklar hvorfor avkrysning/«velg alle»/«Fakturer valgte» er borte. */}
        {!canBillLines && (
          <p className="px-5 py-2.5 text-xs text-[var(--color-text-secondary)] bg-muted/40 border-b border-border">
            {dateFilterActive
              ? 'Fjern datofilteret for å fakturere enkeltlinjer — med datofilter blander grunnlag og fakturaer ulike dato-akser.'
              : 'Filtrer på ett prosjekt for å fakturere linjer. Da kan du krysse av rapport- og EM-linjer og fakturere dem presist uten å risikere å fakturere samme arbeid to ganger.'}
          </p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted border-b border-border">
              {/* #1: «velg alle» vises kun når linje-fakturering er tillatt. */}
              {canBillLines && (
                <th className="px-4 py-3 w-10 text-left">
                  <input
                    type="checkbox"
                    checked={allSelectableChosen}
                    onChange={toggleAll}
                    disabled={selectableLines.length === 0}
                    aria-label="Velg alle linjer som kan faktureres"
                    className="rounded border-border disabled:opacity-40"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Prosjekt</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Produkt</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Mengde</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Kostpris</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Sum</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Dato</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Kilde</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={fullColSpan} className="py-10 text-center text-[var(--color-text-muted)]">Laster...</td>
              </tr>
            ) : displayLines.length === 0 ? (
              <tr>
                <td colSpan={fullColSpan}>
                  <EmptyState
                    title={hideBilled && lines.length > 0 ? 'Alt er fakturert' : 'Ingen godkjente linjer'}
                    description={hideBilled && lines.length > 0 ? 'Fjern «Skjul fakturerte» for å se de fakturerte linjene.' : 'Endre filteret over for å se andre perioder eller prosjekter.'}
                  />
                </td>
              </tr>
            ) : (
              displayLines.map((l, i) => {
                // #10: any unbilled line with a selectable id (report line OR
                // change-order line) can be picked.
                const key = lineKey(l)
                const selectable = key !== null && !l.billed_at
                const checked = key !== null && selectedLines.has(key)
                return (
                <tr key={l.report_line_id ?? l.change_order_id ?? i} className="border-b border-border hover:bg-muted/40">
                  {/* #1: avkrysningscellen finnes kun når linje-fakturering er tillatt. */}
                  {canBillLines && (
                    <td className="px-4 py-2.5">
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleLine(key)}
                          aria-label={`Velg linje ${l.product_name}`}
                          className="rounded border-border"
                        />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)] max-w-[160px] truncate">{l.project_name}</td>
                  <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{l.product_name}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-text-secondary)]">
                    {fmtQty(l.quantity)} {l.unit}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-text-secondary)]">{fmt(l.cost_price)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-[var(--color-text-primary)]">{fmt(l.cost_total)}</td>
                  <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{l.date}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill tone={l.source === 'report' ? 'blue' : 'primary'}>
                      {l.source === 'report' ? 'Rapport' : 'EM'}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-2.5">
                    {/* 4.7 / #10: per-linje fakturert-status for BÅDE rapport- og
                        EM-/CO-linjer. CO-linjer bærer nå ekte billed_at (migrasjon
                        0017) og kan linje-faktureres på lik linje, så de viser
                        samme Fakturert/Ikke fakturert-pill som rapportlinjene. */}
                    <StatusPill tone={l.billed_at ? 'green' : 'gray'}>
                      {l.billed_at ? 'Fakturert' : 'Ikke fakturert'}
                    </StatusPill>
                  </td>
                </tr>
                )
              })
            )}
          </tbody>
          {summary && displayLines.length > 0 && (
            <tfoot>
              <tr className="bg-muted border-t border-border">
                <td colSpan={footerLeadSpan} className="px-4 py-3 text-sm font-semibold text-[var(--color-text-secondary)]">Totalt godkjent</td>
                <td className="px-4 py-3 text-right text-sm font-bold text-[var(--color-text-primary)]">
                  {fmt(summary.total_cost)}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {confirmDialog}
    </main>
  )
}
