'use client'

import { useEffect, useState, useCallback } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import type { Project, Subcontractor, ProjectInvoice } from '@/types'
import { fmtNOK as fmt, fmtNumber } from '@/lib/format'
import Field from '@/components/ui/Field'
import Card from '@/components/ui/Card'
import StatusPill from '@/components/ui/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import ConfirmDialog from '@/components/ConfirmDialog'

const fmtQty = (n: number) => fmtNumber(n, 2)

type LineItem = {
  report_line_id?: string
  change_order_id?: string
  project_id: string
  project_name: string
  subcontractor_id: string | null
  subcontractor_name: string
  product_name: string
  unit: string
  quantity: number
  cost_price: number
  sales_price: number
  cost_total: number
  sales_total: number
  date: string
  source: 'report' | 'change_order'
}

type Summary = {
  line_count: number
  total_cost: number
  total_sales_value: number
  profit: number
  margin: string
}

export default function InvoiceBasisPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([])
  const [lines, setLines] = useState<LineItem[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)

  const [projectFilter, setProjectFilter] = useState('all')
  const [subFilter, setSubFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState<'ue' | 'customer'>('ue')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // A-konto mot kunde: registrerte fakturaer (project_invoices). Systemet er
  // IKKE et fakturasystem — fakturering skjer utenfor; her loggføres kun
  // dato/beløp/notat så «produsert − fakturert = gjenstående» kan vises.
  const [invoices, setInvoices] = useState<ProjectInvoice[]>([])
  const [invForm, setInvForm] = useState({ amount: '', date: new Date().toISOString().split('T')[0], projectId: '', comment: '' })
  const [invSaving, setInvSaving] = useState(false)
  const [invError, setInvError] = useState('')
  const [confirmDeleteInvoice, setConfirmDeleteInvoice] = useState<string | null>(null)

  const fetchInvoices = useCallback(async () => {
    const data = await fetch('/api/invoices').then((r) => (r.ok ? r.json() : []))
    setInvoices(Array.isArray(data) ? data : [])
  }, [])
  useEffect(() => { fetchInvoices() }, [fetchInvoices])

  async function registerInvoice(e: React.FormEvent) {
    e.preventDefault()
    setInvError('')
    const amount = Number(invForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) { setInvError('Oppgi et gyldig beløp'); return }
    if (!invForm.projectId) { setInvError('Velg prosjekt'); return }
    setInvSaving(true)
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: invForm.projectId, amount, invoice_date: invForm.date, comment: invForm.comment }),
    })
    setInvSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setInvError((d as { error?: string }).error ?? 'Lagring feilet')
      return
    }
    setInvForm((f) => ({ ...f, amount: '', comment: '' }))
    fetchInvoices()
  }

  async function deleteInvoice(id: string) {
    await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
    setConfirmDeleteInvoice(null)
    fetchInvoices()
  }

  // Trio-tallene respekterer prosjektfilteret: produsert kommer ferdig
  // filtrert fra API-et; fakturert filtreres her tilsvarende.
  const visibleInvoices = projectFilter === 'all'
    ? invoices
    : invoices.filter((i) => i.project_id === projectFilter)
  const invoicedTotal = visibleInvoices.reduce((s, i) => s + i.amount, 0)
  const producedValue = summary?.total_sales_value ?? 0
  const remainingValue = producedValue - invoicedTotal
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]))

  useEffect(() => {
    Promise.all([
      fetch('/api/projects').then((r) => r.json()),
      fetch('/api/subcontractors').then((r) => r.json()),
    ]).then(([projs, subs]) => {
      setProjects(Array.isArray(projs) ? projs.filter((p: Project) => !p.deleted) : [])
      setSubcontractors(Array.isArray(subs) ? subs : [])
    })
  }, [])

  const fetchBasis = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ type: typeFilter })
    if (projectFilter !== 'all') params.set('project_id', projectFilter)
    if (subFilter !== 'all') params.set('subcontractor_id', subFilter)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)

    const data = await fetch(`/api/invoice-basis?${params}`).then((r) => r.json())
    setLines(data.lines ?? [])
    setSummary(data.summary ?? null)
    setLoading(false)
  }, [projectFilter, subFilter, typeFilter, dateFrom, dateTo])

  useEffect(() => { fetchBasis() }, [fetchBasis])

  function exportCSV() {
    const header = typeFilter === 'ue'
      ? ['Prosjekt', 'Underentreprenør', 'Produkt', 'Enhet', 'Mengde', 'Kostpris', 'Sum kostnad', 'Dato', 'Kilde']
      : ['Prosjekt', 'Produkt', 'Enhet', 'Mengde', 'Salgspris', 'Sum salgsverdi', 'Dato', 'Kilde']

    const rows = lines.map((l) =>
      typeFilter === 'ue'
        ? [l.project_name, l.subcontractor_name, l.product_name, l.unit, fmtQty(l.quantity), l.cost_price.toFixed(2), l.cost_total.toFixed(2), l.date, l.source === 'report' ? 'Rapport' : 'Endringsmelding']
        : [l.project_name, l.product_name, l.unit, fmtQty(l.quantity), l.sales_price.toFixed(2), l.sales_total.toFixed(2), l.date, l.source === 'report' ? 'Rapport' : 'Endringsmelding']
    )

    const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fakturagrunnlag_${typeFilter}_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Fakturagrunnlag</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">Godkjente linjer og endringsmeldinger klar for fakturering</p>
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

      {/* Filters */}
      <Card className="p-4 flex flex-wrap gap-4 items-end">
        <Field label="Type">
          <div className="flex gap-1 bg-muted rounded-lg p-0.5">
            {(['ue', 'customer'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${typeFilter === t ? 'bg-white shadow-sm text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
              >
                {t === 'ue' ? 'Kostnad fra UE' : 'Salg til kunde'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Prosjekt">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-blue-500"
          >
            <option value="all">Alle prosjekter</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Underentreprenør">
          <select
            value={subFilter}
            onChange={(e) => setSubFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-blue-500"
          >
            <option value="all">Alle UE</option>
            {subcontractors.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
          </select>
        </Field>
        <Field label="Fra dato">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-blue-500"
          />
        </Field>
        <Field label="Til dato">
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-blue-500"
          />
        </Field>
      </Card>

      {/* Summary — kun kostnadstotalen i UE-modus. I kunde-modus eier
          a-konto-trioen (produsert/fakturert/gjenstår) toppen; fortjeneste/
          margin er analyse og hører hjemme på totaløkonomi. */}
      {summary && typeFilter === 'ue' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Total kostnad</p>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{fmt(summary.total_cost)}</p>
          </Card>
        </div>
      )}

      {/* A-konto mot kunde — produsert / fakturert / gjenstående + enkel
          registrering. Fakturering skjer utenfor systemet; dette er kun
          loggføring (dato + beløp + notat) per prosjekt. */}
      {typeFilter === 'customer' && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">A-konto-fakturering</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Registrer fakturert beløp — gjenstående oppdateres automatisk</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border">
            <div className="bg-card p-4">
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Produsert verdi</p>
              <p className="text-xl font-bold text-[var(--color-text-primary)] mt-1">{fmt(producedValue)}</p>
            </div>
            <div className="bg-card p-4">
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Fakturert hittil</p>
              <p className="text-xl font-bold text-primary mt-1">{fmt(invoicedTotal)}</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">{visibleInvoices.length} {visibleInvoices.length === 1 ? 'faktura' : 'fakturaer'}</p>
            </div>
            <div className="bg-card p-4">
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Gjenstår å fakturere</p>
              <p className={`text-xl font-bold mt-1 ${remainingValue >= 0 ? 'text-[var(--color-text-primary)]' : 'text-danger'}`}>{fmt(remainingValue)}</p>
            </div>
          </div>

          <form onSubmit={registerInvoice} className="px-4 py-3 border-t border-border flex flex-wrap gap-3 items-end">
            <Field label="Beløp (NOK)">
              <input
                type="number" min="0" step="any" value={invForm.amount}
                onChange={(e) => setInvForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0"
                className="w-36 px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-blue-500"
              />
            </Field>
            <Field label="Fakturadato">
              <input
                type="date" value={invForm.date}
                onChange={(e) => setInvForm((f) => ({ ...f, date: e.target.value }))}
                className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-blue-500"
              />
            </Field>
            <Field label="Prosjekt">
              <select
                value={invForm.projectId}
                onChange={(e) => setInvForm((f) => ({ ...f, projectId: e.target.value }))}
                className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="">Velg prosjekt…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Notat (valgfritt)">
              <input
                type="text" value={invForm.comment}
                onChange={(e) => setInvForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder="Fakturanr. eller merknad"
                className="w-52 px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-blue-500"
              />
            </Field>
            <button
              type="submit" disabled={invSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary-hover disabled:opacity-50"
            >
              <Plus size={14} /> {invSaving ? 'Lagrer…' : 'Registrer faktura'}
            </button>
            {invError && <p className="text-sm text-danger basis-full">{invError}</p>}
          </form>

          {visibleInvoices.length > 0 && (
            <div className="border-t border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                    <th className="px-4 py-2.5">Dato</th>
                    <th className="px-4 py-2.5">Prosjekt</th>
                    <th className="px-4 py-2.5">Notat</th>
                    <th className="px-4 py-2.5 text-right">Beløp</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {visibleInvoices
                    .slice()
                    .sort((a, b) => (b.invoice_date ?? '').localeCompare(a.invoice_date ?? ''))
                    .map((inv) => (
                      <tr key={inv.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2.5 whitespace-nowrap text-[var(--color-text-secondary)]">{inv.invoice_date}</td>
                        <td className="px-4 py-2.5 text-[var(--color-text-secondary)] max-w-[220px] truncate">{projectNameById.get(inv.project_id) ?? '–'}</td>
                        <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{inv.comment || '–'}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-[var(--color-text-primary)] whitespace-nowrap">{fmt(inv.amount)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteInvoice(inv.id)}
                            title="Slett registrering"
                            className="p-1 text-[var(--color-text-muted)] hover:text-danger hover:bg-danger-soft rounded"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {confirmDeleteInvoice && (
        <ConfirmDialog
          title="Slett fakturaregistrering?"
          message="Registreringen fjernes fra historikken og «Gjenstår å fakturere» justeres opp tilsvarende."
          confirmLabel="Slett"
          onConfirm={() => deleteInvoice(confirmDeleteInvoice)}
          onCancel={() => setConfirmDeleteInvoice(null)}
        />
      )}

      {/* Lines table — åpen i kostnadsmodus (der den er hovedinnholdet),
          lukket i kunde-modus der a-konto-kortet eier flaten. */}
      <details open={typeFilter === 'ue'} className="bg-white rounded-lg shadow overflow-hidden group">
        <summary className="px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] cursor-pointer select-none list-none inline-flex items-center gap-1.5 w-full">
          <span className="inline-block transition-transform group-open:rotate-90 text-[var(--color-text-muted)]">›</span>
          Produktlinjer{lines.length > 0 ? ` (${lines.length})` : ''}
        </summary>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted border-b border-border">
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Prosjekt</th>
              {typeFilter === 'ue' && (
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">UE</th>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Produkt</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Mengde</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Pris/enhet</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                {typeFilter === 'ue' ? 'Sum kostnad' : 'Sum salgsverdi'}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Dato</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Kilde</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-[var(--color-text-muted)]">Laster...</td>
              </tr>
            ) : lines.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    title="Ingen godkjente linjer"
                    description="Juster filtrene over, eller vent på at flere rapporter blir godkjent."
                  />
                </td>
              </tr>
            ) : (
              lines.map((l, i) => (
                <tr key={l.report_line_id ?? l.change_order_id ?? i} className="border-b border-gray-50 hover:bg-muted">
                  <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)] max-w-[180px] truncate">{l.project_name}</td>
                  {typeFilter === 'ue' && (
                    <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{l.subcontractor_name}</td>
                  )}
                  <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{l.product_name}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-text-secondary)]">
                    {fmtQty(l.quantity)} {l.unit}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-text-secondary)]">
                    {fmt(typeFilter === 'ue' ? l.cost_price : l.sales_price)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-[var(--color-text-primary)]">
                    {fmt(typeFilter === 'ue' ? l.cost_total : l.sales_total)}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{l.date}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill tone={l.source === 'report' ? 'blue' : 'primary'}>
                      {l.source === 'report' ? 'Rapport' : 'EM'}
                    </StatusPill>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {summary && lines.length > 0 && (
            <tfoot>
              <tr className="bg-muted border-t border-border">
                <td colSpan={typeFilter === 'ue' ? 5 : 4} className="px-4 py-3 text-sm font-semibold text-[var(--color-text-secondary)]">
                  Totalt
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold text-[var(--color-text-primary)]">
                  {fmt(typeFilter === 'ue' ? summary.total_cost : summary.total_sales_value)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </details>
    </main>
  )
}
