'use client'

import { useEffect, useState, useCallback } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { Project } from '@/types'

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

function fmt(n: number) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(n)
}

function fmtQty(n: number) {
  return new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 2 }).format(n)
}

export default function UEInvoiceBasisPage() {
  const [subId, setSubId] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [lines, setLines] = useState<LineItem[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)

  const [projectFilter, setProjectFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

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

  useEffect(() => {
    if (subId) fetchBasis()
  }, [fetchBasis, subId])

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
          onClick={fetchBasis}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted text-[var(--color-text-primary)]"
        >
          <RefreshCw size={13} />
          Oppdater
        </button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-card rounded-lg border border-border p-4">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Linjer</p>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{summary.line_count}</p>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">Total kostnad</p>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1">{fmt(summary.total_cost)}</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
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
                <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-[var(--color-text-secondary)]">Totalt</td>
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
