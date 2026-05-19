'use client'

import { useEffect, useState, useCallback } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { Project, Subcontractor } from '@/types'
import { fmtNOK as fmt, fmtNumber } from '@/lib/format'

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
          <h1 className="text-xl font-bold text-gray-900">Fakturagrunnlag</h1>
          <p className="text-sm text-gray-500 mt-0.5">Godkjente linjer og endringsmeldinger klar for fakturering</p>
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
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {(['ue', 'customer'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${typeFilter === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t === 'ue' ? 'UE → Oss (kostnad)' : 'Oss → Kunde (salg)'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Prosjekt</label>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          >
            <option value="all">Alle prosjekter</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Underentreprenør</label>
          <select
            value={subFilter}
            onChange={(e) => setSubFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          >
            <option value="all">Alle UE</option>
            {subcontractors.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Fra dato</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Til dato</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
        <button
          onClick={fetchBasis}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw size={13} />
          Oppdater
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Linjer</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{summary.line_count}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              {typeFilter === 'ue' ? 'Total kostnad' : 'Total salgsverdi'}
            </p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {fmt(typeFilter === 'ue' ? summary.total_cost : summary.total_sales_value)}
            </p>
          </div>
          {typeFilter === 'customer' && (
            <>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Fortjeneste</p>
                <p className={`text-2xl font-bold mt-1 ${summary.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {fmt(summary.profit)}
                </p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Margin</p>
                <p className={`text-2xl font-bold mt-1 ${Number(summary.margin) >= 10 ? 'text-green-700' : 'text-orange-500'}`}>
                  {summary.margin}%
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Lines table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Prosjekt</th>
              {typeFilter === 'ue' && (
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">UE</th>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Produkt</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Mengde</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Pris/enhet</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                {typeFilter === 'ue' ? 'Sum kostnad' : 'Sum salgsverdi'}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Dato</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Kilde</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-gray-400">Laster...</td>
              </tr>
            ) : lines.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-gray-400">
                  Ingen godkjente linjer for valgt filter
                </td>
              </tr>
            ) : (
              lines.map((l, i) => (
                <tr key={l.report_line_id ?? l.change_order_id ?? i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[180px] truncate">{l.project_name}</td>
                  {typeFilter === 'ue' && (
                    <td className="px-4 py-2.5 text-gray-600">{l.subcontractor_name}</td>
                  )}
                  <td className="px-4 py-2.5 text-gray-700">{l.product_name}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">
                    {fmtQty(l.quantity)} {l.unit}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600">
                    {fmt(typeFilter === 'ue' ? l.cost_price : l.sales_price)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                    {fmt(typeFilter === 'ue' ? l.cost_total : l.sales_total)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{l.date}</td>
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
              <tr className="bg-gray-50 border-t border-gray-200">
                <td colSpan={typeFilter === 'ue' ? 5 : 4} className="px-4 py-3 text-sm font-semibold text-gray-700">
                  Totalt
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">
                  {fmt(typeFilter === 'ue' ? summary.total_cost : summary.total_sales_value)}
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
