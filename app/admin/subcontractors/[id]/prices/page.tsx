'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Copy, Percent, Plus } from 'lucide-react'
import type { Product, Subcontractor, SubcontractorProductPrice } from '@/types'
import SortableTable from '@/components/SortableTable'
import NumberInput from '@/components/NumberInput'
import { fmtNOK as fmt, fmtProductLabel } from '@/lib/format'

type PreviewRow = {
  productId: string
  name: string
  unit: string
  oldPrice: number
  newPrice: number
  delta: number
}

export default function SubcontractorPricesPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const highlightIds = new Set((searchParams.get('highlight') ?? '').split(',').filter(Boolean))
  const fromProject = searchParams.get('from_project')

  const [subcontractor, setSubcontractor] = useState<Subcontractor | null>(null)
  const [allSubcontractors, setAllSubcontractors] = useState<Subcontractor[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [prices, setPrices] = useState<SubcontractorProductPrice[]>([])
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const [copyFromId, setCopyFromId] = useState('')
  const [adjustMode, setAdjustMode] = useState<'percent' | 'fixed'>('percent')
  const [adjustValue, setAdjustValue] = useState('')

  // Per-row selection for adjustment
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null)

  const fetchAll = useCallback(async () => {
    const [subs, prods, prs] = await Promise.all([
      fetch('/api/subcontractors').then((r) => r.json()),
      fetch('/api/products').then((r) => r.json()),
      fetch(`/api/subcontractor-prices?subcontractor_id=${id}`).then((r) => r.json()),
    ])
    const subList = subs as Subcontractor[]
    const sub = subList.find((s) => s.id === id) ?? null
    setSubcontractor(sub)
    setAllSubcontractors(subList.filter((s) => s.id !== id))
    setProducts(prods)
    setPrices(prs)
    const initInputs: Record<string, string> = {}
    ;(prods as Product[]).forEach((p: Product) => {
      const existing = (prs as SubcontractorProductPrice[]).find((pr: SubcontractorProductPrice) => pr.product_id === p.id)
      initInputs[p.id] = existing ? String(existing.cost_price) : ''
    })
    setInputs(initInputs)
    setLoading(false)
  }, [id])

  async function copyPricesFrom(sourceId: string) {
    if (!sourceId) return
    const sourcePrices: SubcontractorProductPrice[] = await fetch(`/api/subcontractor-prices?subcontractor_id=${sourceId}`).then((r) => r.json())
    setInputs((prev) => {
      const next = { ...prev }
      for (const sp of sourcePrices) {
        next[sp.product_id] = String(sp.cost_price)
      }
      return next
    })
    setCopyFromId('')
  }

  function buildPreview(): PreviewRow[] {
    const val = Number(adjustValue)
    if (!val || isNaN(val)) return []
    const targetIds = selectedRows.size > 0 ? selectedRows : new Set(products.map((p) => p.id))
    return products
      .filter((p) => targetIds.has(p.id) && inputs[p.id] && !isNaN(Number(inputs[p.id])))
      .map((p) => {
        const current = Number(inputs[p.id])
        if (!current) return null
        const newPrice = adjustMode === 'percent'
          ? Math.round(current * (1 + val / 100) * 100) / 100
          : Math.round((current + val) * 100) / 100
        return {
          productId: p.id,
          name: fmtProductLabel(p),
          unit: p.unit,
          oldPrice: current,
          newPrice,
          delta: newPrice - current,
        }
      })
      .filter((r): r is PreviewRow => r !== null)
  }

  function handlePreviewAdjustment() {
    const preview = buildPreview()
    if (preview.length === 0) return
    setPreviewRows(preview)
  }

  function confirmAdjustment() {
    if (!previewRows) return
    setInputs((prev) => {
      const next = { ...prev }
      for (const row of previewRows) {
        next[row.productId] = String(row.newPrice)
      }
      return next
    })
    setPreviewRows(null)
    setAdjustValue('')
    setSelectedRows(new Set())
  }

  useEffect(() => { fetchAll() }, [fetchAll])

  const dirtyCount = products.filter((p) => {
    const inputVal = inputs[p.id] ?? ''
    const existing = prices.find((pr) => pr.product_id === p.id)
    const savedVal = existing ? String(existing.cost_price) : ''
    return inputVal !== savedVal && (inputVal !== '' || savedVal !== '')
  }).length

  async function saveAll() {
    setSaving(true)
    const ops: Promise<void>[] = []
    for (const p of products) {
      const value = inputs[p.id] ?? ''
      if (value === '' || isNaN(Number(value))) continue
      const existing = prices.find((pr) => pr.product_id === p.id)
      const savedVal = existing ? String(existing.cost_price) : ''
      if (value === savedVal) continue
      if (existing) {
        ops.push(
          fetch('/api/subcontractor-prices', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: existing.id, cost_price: Number(value) }),
          }).then(() => {})
        )
      } else {
        ops.push(
          fetch('/api/subcontractor-prices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subcontractor_id: id, product_id: p.id, cost_price: Number(value) }),
          }).then(() => {})
        )
      }
    }
    await Promise.all(ops)
    await fetchAll()
    setSaving(false)
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Laster...</div>

  const sortedProducts = highlightIds.size > 0
    ? [...products].sort((a, b) => {
        const aHighlight = highlightIds.has(a.id) ? 0 : 1
        const bHighlight = highlightIds.has(b.id) ? 0 : 1
        return aHighlight - bHighlight
      })
    : products

  const allSelected = selectedRows.size === products.length && products.length > 0
  const toggleSelectAll = () => setSelectedRows(allSelected ? new Set() : new Set(products.map((p) => p.id)))
  const toggleRow = (pid: string) => setSelectedRows((prev) => {
    const next = new Set(prev)
    next.has(pid) ? next.delete(pid) : next.add(pid)
    return next
  })

  const adjustTargetLabel = selectedRows.size > 0 ? `${selectedRows.size} valgte` : 'alle med pris'

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">
      {/* Preview/confirm dialog */}
      {previewRows && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Forhåndsvisning — prisjustering</h2>
              <button onClick={() => setPreviewRows(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3">
              <p className="text-sm text-gray-500 mb-3">
                Endringen vil gjelde for <strong>{previewRows.length} produkter</strong>.
                Gammel og ny pris vises under.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="py-2 text-left text-xs font-medium text-gray-500">Produkt</th>
                    <th className="py-2 text-right text-xs font-medium text-gray-500">Gammel pris</th>
                    <th className="py-2 text-right text-xs font-medium text-gray-500">Ny pris</th>
                    <th className="py-2 text-right text-xs font-medium text-gray-500">Endring</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.productId} className="border-b border-gray-50">
                      <td className="py-2 text-gray-900">{row.name} <span className="text-gray-400 text-xs">({row.unit})</span></td>
                      <td className="py-2 text-right text-gray-500">{fmt(row.oldPrice)}</td>
                      <td className="py-2 text-right font-medium text-gray-900">{fmt(row.newPrice)}</td>
                      <td className={`py-2 text-right text-xs font-semibold ${row.delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {row.delta >= 0 ? '+' : ''}{fmt(row.delta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex gap-3 justify-end">
              <button onClick={() => setPreviewRows(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Avbryt</button>
              <button onClick={confirmAdjustment} className="px-4 py-2 text-sm bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700">Bekreft og bruk</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/admin/subcontractors" className="text-gray-400 hover:text-gray-600 text-sm">← Underentreprenører</Link>
        <h1 className="text-xl font-bold text-gray-900">Priser — {subcontractor?.company_name ?? id}</h1>
        <div className="ml-auto flex items-center gap-3">
          {dirtyCount > 0 && (
            <span className="text-xs text-amber-700 bg-amber-100 px-2 py-1 rounded-full font-medium">{dirtyCount} ulagrede endringer</span>
          )}
          <button onClick={saveAll} disabled={saving || dirtyCount === 0} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {saving ? 'Lagrer...' : 'Lagre alle endringer'}
          </button>
          {fromProject && (
            <button onClick={() => router.push(`/admin/projects/${fromProject}`)} className="px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition-colors">
              ← Tilbake til prosjekt
            </button>
          )}
        </div>
      </div>

      {highlightIds.size > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-800">
          <strong>{highlightIds.size} produkter</strong> mangler pris og er merket nedenfor.
          {fromProject && <span className="ml-2 text-orange-600">Legg inn prisene, lagre, og trykk «Tilbake til prosjekt» for å fullføre tildelingen.</span>}
        </div>
      )}

      {/* Toolbox row */}
      <div className="flex flex-wrap gap-3">
        {/* Copy from another UE */}
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm">
          <Copy size={14} className="text-gray-400 flex-none" />
          <span className="text-xs font-medium text-gray-600 whitespace-nowrap">Kopier priser fra</span>
          <select value={copyFromId} onChange={(e) => setCopyFromId(e.target.value)} className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-500">
            <option value="">Velg UE…</option>
            {allSubcontractors.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
          </select>
          <button onClick={() => copyPricesFrom(copyFromId)} disabled={!copyFromId} className="px-3 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40 font-medium">Kopier</button>
        </div>

        {/* Mass adjustment */}
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm">
          <Percent size={14} className="text-gray-400 flex-none" />
          <span className="text-xs font-medium text-gray-600 whitespace-nowrap">
            Juster {adjustTargetLabel}
          </span>
          <div className="flex gap-0.5 bg-gray-100 rounded p-0.5">
            {(['percent', 'fixed'] as const).map((m) => (
              <button key={m} onClick={() => setAdjustMode(m)} className={`px-2 py-0.5 text-xs rounded font-medium transition-colors ${adjustMode === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                {m === 'percent' ? '%' : 'kr'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setAdjustValue((v) => v.startsWith('-') ? v.slice(1) : `-${v}`)} className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-800 border border-gray-200 rounded text-xs font-bold" title="Negativt (reduser)">−</button>
            <NumberInput
              value={adjustValue.replace('-', '')}
              onChange={(raw) => setAdjustValue((prev) => (prev.startsWith('-') ? '-' : '') + raw)}
              placeholder={adjustMode === 'percent' ? '5' : '100'}
              className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
            />
          </div>
          <span className="text-xs text-gray-400">{adjustMode === 'percent' ? '%' : 'kr'}</span>
          <button onClick={handlePreviewAdjustment} disabled={!adjustValue} className="flex items-center gap-1 px-3 py-1 text-xs bg-gray-700 text-white rounded-md hover:bg-gray-800 disabled:opacity-40 font-medium">
            <Plus size={11} />
            Forhåndsvis
          </button>
        </div>

        {selectedRows.size > 0 && (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 shadow-sm">
            <span className="text-xs font-medium text-blue-700">{selectedRows.size} rader valgt</span>
            <button onClick={() => setSelectedRows(new Set())} className="text-xs text-blue-500 hover:text-blue-700">Fjern valg</button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow">
        <SortableTable
          columns={[
            {
              key: 'select',
              label: (
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-4 w-4" />
              ),
              render: (p: Product) => (
                <input
                  type="checkbox"
                  checked={selectedRows.has(p.id)}
                  onChange={() => toggleRow(p.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4"
                />
              ),
            },
            { key: 'description', label: 'Kode', sortable: true },
            { key: 'name', label: 'Produktnavn', sortable: true },
            { key: 'unit', label: 'Enhet', sortable: true },
            { key: 'customer_price', label: 'Utsalgspris', sortable: true, render: (p: Product) => fmt(p.customer_price) },
            {
              key: 'cost_price_input',
              label: 'Kostpris (din)',
              render: (p: Product) => (
                <NumberInput
                  placeholder="0"
                  value={inputs[p.id] ?? ''}
                  onChange={(raw) => setInputs((prev) => ({ ...prev, [p.id]: raw }))}
                  className={`w-28 px-2 py-1 text-sm text-gray-900 border rounded focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                    highlightIds.has(p.id) ? 'border-orange-400 bg-orange-50' : 'border-gray-300'
                  }`}
                />
              ),
            },
            {
              key: 'profit',
              label: 'Fortjeneste',
              sortable: true,
              getValue: (p: Product) => p.customer_price - (Number(inputs[p.id]) || 0),
              render: (p: Product) => {
                const costPrice = Number(inputs[p.id]) || 0
                const profit = p.customer_price - costPrice
                return (
                  <span className={`text-sm font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {costPrice > 0 ? fmt(profit) : '–'}
                  </span>
                )
              },
            },
          ]}
          data={sortedProducts}
          emptyText="Ingen produkter i registeret"
          rowClassName={(p: Product) =>
            selectedRows.has(p.id)
              ? 'border-b border-blue-200 bg-blue-50'
              : highlightIds.has(p.id)
              ? 'border-b border-orange-200 bg-orange-50'
              : 'border-b border-gray-100'
          }
        />
      </div>
    </main>
  )
}
