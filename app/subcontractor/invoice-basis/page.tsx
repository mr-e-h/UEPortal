'use client'

import { useEffect, useState, useCallback } from 'react'
import { Download, RefreshCw, Plus, Trash2 } from 'lucide-react'
import type { Project } from '@/types'
import { fmtNOK as fmt, fmtNumber } from '@/lib/format'

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
  const [subId, setSubId] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [lines, setLines] = useState<LineItem[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [invoices, setInvoices] = useState<UEInvoice[]>([])

  const [projectFilter, setProjectFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Invoice form state
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])
  const [invoiceNote, setInvoiceNote] = useState('')
  const [invoiceProjectId, setInvoiceProjectId] = useState('all')
  const [savingInvoice, setSavingInvoice] = useState(false)

  useEffect(() => {
    const sid = localStorage.getItem('subcontractor_id') ?? ''
    setSubId(sid)
    if (sid) {
      fetch(`/api/subcontractor/projects?subcontractor_id=${sid}`)
        .then((r) => r.json())
        .then((data) => setProjects(Array.isArray(data) ? data : []))
    }
  }, [])

  const fetchBasis = useCallback(async () => {
    if (!subId) return
    setLoading(true)
    const params = new URLSearchParams({ subcontractor_id: subId })
    if (projectFilter !== 'all') params.set('project_id', projectFilter)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)

    const data = await fetch(`/api/subcontractor/invoice-basis?${params}`).then((r) => r.json())
    setLines(data.lines ?? [])
    setSummary(data.summary ?? null)
    setLoading(false)
  }, [subId, projectFilter, dateFrom, dateTo])

  const fetchInvoices = useCallback(async () => {
    if (!subId) return
    const params = new URLSearchParams({ subcontractor_id: subId })
    if (projectFilter !== 'all') params.set('project_id', projectFilter)
    const data = await fetch(`/api/subcontractor/ue-invoices?${params}`).then((r) => r.json())
    setInvoices(Array.isArray(data) ? data : [])
  }, [subId, projectFilter])

  useEffect(() => {
    if (subId) {
      fetchBasis()
      fetchInvoices()
    }
  }, [fetchBasis, fetchInvoices, subId])

  async function registerInvoice() {
    const amt = Number(invoiceAmount.replace(',', '.'))
    if (!subId || isNaN(amt) || amt <= 0) return
    setSavingInvoice(true)
    await fetch('/api/subcontractor/ue-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subcontractor_id: subId,
        project_id: invoiceProjectId === 'all' ? null : invoiceProjectId,
        amount: amt,
        invoice_date: invoiceDate,
        note: invoiceNote,
      }),
    })
    setInvoiceAmount('')
    setInvoiceNote('')
    await fetchInvoices()
    setSavingInvoice(false)
  }

  async function deleteInvoice(id: string) {
    if (!confirm('Slett denne fakturaregistreringen?')) return
    await fetch(`/api/subcontractor/ue-invoices?id=${id}&subcontractor_id=${subId}`, { method: 'DELETE' })
    await fetchInvoices()
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
  const totalRemaining = totalApproved - totalInvoiced

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Fakturagrunnlag</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Dine godkjente rapportlinjer og endringsmeldinger
          </p>
        </div>
        <button
          onClick={exportCSV}
          disabled={lines.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-40"
        >
          <Download size={14} />
          Eksporter CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-lg border border-border p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Prosjekt</label>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-card text-[var(--color-text-primary)]"
          >
            <option value="all">Alle prosjekter</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Fra dato</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-card text-[var(--color-text-primary)]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Til dato</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-card text-[var(--color-text-primary)]"
          />
        </div>
        <button
          onClick={() => { fetchBasis(); fetchInvoices() }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted text-[var(--color-text-primary)]"
        >
          <RefreshCw size={13} />
          Oppdater
        </button>
      </div>

      {/* Financial summary */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card rounded-lg border border-border p-4">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Linjer</p>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{summary.line_count}</p>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Godkjent total</p>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{fmt(totalApproved)}</p>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Fakturert</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{fmt(totalInvoiced)}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{invoices.length} faktura{invoices.length !== 1 ? 'er' : ''}</p>
          </div>
          <div className={`bg-card rounded-lg border p-4 ${totalRemaining < 0 ? 'border-red-200 bg-red-50' : 'border-border'}`}>
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Gjenstår å fakturere</p>
            <p className={`text-2xl font-bold mt-1 ${totalRemaining < 0 ? 'text-red-600' : totalRemaining === 0 ? 'text-green-600' : 'text-[var(--color-text-primary)]'}`}>
              {fmt(totalRemaining)}
            </p>
          </div>
        </div>
      )}

      {/* Register invoice */}
      <div className="bg-card rounded-lg border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Registrer faktura</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Beløp (NOK)</label>
            <input
              type="number"
              min="0"
              step="1"
              placeholder="0"
              value={invoiceAmount}
              onChange={(e) => setInvoiceAmount(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-white text-[var(--color-text-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Fakturadato</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-white text-[var(--color-text-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Prosjekt</label>
            <select
              value={invoiceProjectId}
              onChange={(e) => setInvoiceProjectId(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-white text-[var(--color-text-primary)]"
            >
              <option value="all">Alle prosjekter</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Notat (valgfritt)</label>
            <input
              type="text"
              placeholder="Fakturanr. eller merknad"
              value={invoiceNote}
              onChange={(e) => setInvoiceNote(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-primary bg-white text-[var(--color-text-primary)]"
            />
          </div>
        </div>
        <button
          onClick={registerInvoice}
          disabled={savingInvoice || !invoiceAmount || Number(invoiceAmount) <= 0}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={14} />
          {savingInvoice ? 'Lagrer...' : 'Registrer faktura'}
        </button>
      </div>

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
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Godkjente linjer</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted border-b border-border">
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Prosjekt</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Produkt</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Mengde</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Kostpris</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Sum</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Dato</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Kilde</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-[var(--color-text-muted)]">Laster...</td>
              </tr>
            ) : lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-[var(--color-text-muted)]">
                  Ingen godkjente linjer for valgt filter
                </td>
              </tr>
            ) : (
              lines.map((l, i) => (
                <tr key={l.report_line_id ?? l.change_order_id ?? i} className="border-b border-border hover:bg-muted/40">
                  <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)] max-w-[160px] truncate">{l.project_name}</td>
                  <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{l.product_name}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-text-secondary)]">
                    {fmtQty(l.quantity)} {l.unit}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-text-secondary)]">{fmt(l.cost_price)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-[var(--color-text-primary)]">{fmt(l.cost_total)}</td>
                  <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{l.date}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      l.source === 'report' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
                    }`}>
                      {l.source === 'report' ? 'Rapport' : 'EM'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {summary && lines.length > 0 && (
            <tfoot>
              <tr className="bg-muted border-t border-border">
                <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-[var(--color-text-secondary)]">Totalt godkjent</td>
                <td className="px-4 py-3 text-right text-sm font-bold text-[var(--color-text-primary)]">
                  {fmt(summary.total_cost)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </main>
  )
}
