'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Pencil, Check, X, PowerOff, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import type { Product, SubcontractorProductPrice } from '@/types'
import NumberInput from '@/components/NumberInput'
import ConfirmDialog from '@/components/ConfirmDialog'
import { COUNTIES } from '@/lib/counties'
import { fmtNumber } from '@/lib/format'
import Field from '@/components/ui/Field'
import StatusPill from '@/components/ui/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'

const empty = { name: '', description: '', unit: 'meter', county: '', customer_price: '' }

const fmt = (n: number) => fmtNumber(n, 2)

type SortKey = 'code' | 'name' | 'unit' | 'county' | 'price' | 'ue_prices' | 'status'
type SortDir = 'asc' | 'desc'

interface Props {
  initialProducts: Product[]
  initialPrices: SubcontractorProductPrice[]
}

export default function ProductsClient({ initialProducts, initialPrices }: Props) {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>(initialProducts)
  const [prices, setPrices] = useState<SubcontractorProductPrice[]>(initialPrices)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<Product>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [countyFilter, setCountyFilter] = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('code')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Mutations re-fetch via the same API so local state and the server-rendered
  // siblings (sidebar badges, etc) both update.
  const fetchAll = useCallback(async () => {
    const [prods, prs] = await Promise.all([
      fetch('/api/products?include_inactive=true').then((r) => r.ok ? r.json() : []),
      fetch('/api/subcontractor-prices').then((r) => r.ok ? r.json() : []),
    ])
    setProducts(Array.isArray(prods) ? prods : [])
    setPrices(Array.isArray(prs) ? prs : [])
    router.refresh()
  }, [router])

  async function handleDelete(id: string) {
    await fetch(`/api/products/${id}`, { method: 'DELETE' })
    setConfirmDeleteId(null)
    fetchAll()
  }

  async function handleBulkDelete() {
    await Promise.all(Array.from(selected).map((id) => fetch(`/api/products/${id}`, { method: 'DELETE' })))
    setSelected(new Set())
    setConfirmBulkDelete(false)
    fetchAll()
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((p) => p.id)))
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  async function handleToggleActive(product: Product) {
    await fetch(`/api/products/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !product.active }),
    })
    fetchAll()
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, customer_price: Number(form.customer_price), active: true }),
    })
    setForm(empty)
    setShowForm(false)
    setSaving(false)
    fetchAll()
  }

  function startEdit(p: Product) {
    setEditingId(p.id)
    setEditForm({ name: p.name, description: p.description, unit: p.unit, county: p.county, customer_price: p.customer_price })
  }

  async function saveEdit(id: string) {
    await fetch(`/api/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    setEditingId(null)
    fetchAll()
  }

  const filtered = products
    .filter((p) => showInactive || p.active !== false)
    .filter((p) => countyFilter === 'all' || p.county === countyFilter)
    .filter((p) => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
    })

  const usedCounties = Array.from(new Set(products.map((p) => p.county).filter(Boolean))).sort()

  // Pre-count UE prices per product so we can both display and sort by it.
  const priceCountByProduct = new Map<string, number>()
  for (const pr of prices) {
    priceCountByProduct.set(pr.product_id, (priceCountByProduct.get(pr.product_id) ?? 0) + 1)
  }

  // Sort the visible rows by the active column. Strings use Norwegian
  // collation; numbers/booleans compare numerically. Clicking a header
  // toggles the direction.
  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    let cmp = 0
    switch (sortKey) {
      case 'code': cmp = (a.description ?? '').localeCompare(b.description ?? '', 'nb'); break
      case 'name': cmp = a.name.localeCompare(b.name, 'nb'); break
      case 'unit': cmp = (a.unit ?? '').localeCompare(b.unit ?? '', 'nb'); break
      case 'county': cmp = (a.county ?? '').localeCompare(b.county ?? '', 'nb'); break
      case 'price': cmp = a.customer_price - b.customer_price; break
      case 'ue_prices': cmp = (priceCountByProduct.get(a.id) ?? 0) - (priceCountByProduct.get(b.id) ?? 0); break
      case 'status': cmp = (a.active === false ? 0 : 1) - (b.active === false ? 0 : 1); break
    }
    return cmp * dir
  })

  // No loading state — initial data shipped server-side via RSC props.

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Produktregister</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {products.filter((p) => p.active !== false).length} aktive · {products.filter((p) => p.active === false).length} inaktive
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          {showForm ? 'Avbryt' : '+ Legg til produkt'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-blue-50 border border-blue-200 rounded-lg p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { key: 'name', label: 'Navn', required: true },
            { key: 'description', label: 'Kode / Beskrivelse', required: false },
            { key: 'unit', label: 'Enhet', required: true },
          ].map(({ key, label, required }) => (
            <Field key={key} label={label}>
              <input
                type="text"
                required={required}
                value={form[key as keyof typeof form]}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
              />
            </Field>
          ))}
          <Field label="Fylke">
            <select
              value={form.county}
              onChange={(e) => setForm((prev) => ({ ...prev, county: e.target.value }))}
              className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
            >
              <option value="">Velg fylke</option>
              {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Utsalgspris (kr)">
            <NumberInput
              required
              value={form.customer_price}
              onChange={(raw) => setForm((prev) => ({ ...prev, customer_price: raw }))}
              className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
            />
          </Field>
          <div className="col-span-full">
            <Button type="submit" disabled={saving}>
              {saving ? 'Lagrer...' : 'Lagre produkt'}
            </Button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Søk på navn eller kode..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
        <select
          value={countyFilter}
          onChange={(e) => setCountyFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
        >
          <option value="all">Alle fylker</option>
          {usedCounties.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Vis inaktive
        </label>
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} produkter</span>
        {selected.size > 0 && (
          <button
            onClick={() => setConfirmBulkDelete(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
          >
            <Trash2 size={14} />
            Slett valgte ({selected.size})
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 w-8">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              <SortTh label="Kode" sortKey="code" current={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortTh label="Navn" sortKey="name" current={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortTh label="Enhet" sortKey="unit" current={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortTh label="Fylke" sortKey="county" current={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortTh label="Utsalgspris" sortKey="price" current={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
              <SortTh label="UE-priser" sortKey="ue_prices" current={sortKey} dir={sortDir} onSort={toggleSort} align="center" />
              <SortTh label="Status" sortKey="status" current={sortKey} dir={sortDir} onSort={toggleSort} align="center" />
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    title="Ingen produkter funnet"
                    description={searchQuery || countyFilter !== 'all'
                      ? 'Prøv å justere filtrene eller søket.'
                      : 'Trykk «Legg til produkt» for å starte produktregisteret.'}
                  />
                </td>
              </tr>
            ) : (
              sorted.map((p) => {
                const isEditing = editingId === p.id
                const priceCount = priceCountByProduct.get(p.id) ?? 0
                return (
                  <tr key={p.id} className={`border-b border-gray-100 hover:bg-gray-50 ${p.active === false ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5 w-8">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.description ?? ''}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                          className="w-full px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none"
                        />
                      ) : (
                        <span className="font-medium text-gray-900">{p.description}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.name ?? ''}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                          className="w-full px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none"
                        />
                      ) : (
                        <span className="text-gray-700">{p.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editForm.unit ?? ''}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, unit: e.target.value }))}
                          className="w-20 px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none"
                        />
                      ) : (
                        <span className="text-gray-500">{p.unit}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isEditing ? (
                        <select
                          value={editForm.county ?? ''}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, county: e.target.value }))}
                          className="px-2 py-1 text-sm border border-blue-400 rounded focus:outline-none"
                        >
                          <option value="">–</option>
                          {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <span className="text-gray-500">{p.county || '–'}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {isEditing ? (
                        <NumberInput
                          value={editForm.customer_price ?? ''}
                          onChange={(raw) => setEditForm((prev) => ({ ...prev, customer_price: Number(raw) || 0 }))}
                          className="w-28 px-2 py-1 text-sm text-right border border-blue-400 rounded focus:outline-none"
                        />
                      ) : (
                        <span className="font-medium text-gray-900">{fmt(p.customer_price)} kr</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {priceCount === 0
                        ? <StatusPill tone="amber">Priser mangler</StatusPill>
                        : <StatusPill tone="green">{priceCount} UE</StatusPill>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {p.active !== false
                        ? <StatusPill tone="green">Aktiv</StatusPill>
                        : <StatusPill tone="gray">Inaktiv</StatusPill>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveEdit(p.id)} title="Lagre" className="p-1 text-green-600 hover:bg-green-50 rounded">
                              <Check size={14} />
                            </button>
                            <button onClick={() => setEditingId(null)} title="Avbryt" className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(p)} title="Rediger" className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleToggleActive(p)}
                              title={p.active !== false ? 'Deaktiver' : 'Aktiver'}
                              className={`p-1 rounded ${p.active !== false ? 'text-gray-400 hover:text-orange-500 hover:bg-orange-50' : 'text-orange-400 hover:text-green-600 hover:bg-green-50'}`}
                            >
                              <PowerOff size={14} />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(p.id)}
                              title="Slett permanent"
                              className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title="Slett produkt permanent?"
          message="Produktet og tilknyttede UE-priser slettes. Eksisterende budsjettlinjer beholder prissnapshotene sine. Vurder å deaktivere produktet i stedet."
          confirmLabel="Slett permanent"
          onConfirm={() => handleDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      {confirmBulkDelete && (
        <ConfirmDialog
          title={`Slett ${selected.size} produkter permanent?`}
          message="Alle valgte produkter og tilknyttede UE-priser slettes. Dette kan ikke angres."
          confirmLabel="Slett alle valgte"
          onConfirm={handleBulkDelete}
          onCancel={() => setConfirmBulkDelete(false)}
        />
      )}
    </main>
  )
}

/** Clickable, sortable column header with an up/down indicator. Mirrors the
 *  pattern used in the users/subcontractor tables. */
function SortTh({ label, sortKey: key, current, dir, onSort, align = 'left' }: {
  label: string
  sortKey: SortKey
  current: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
  align?: 'left' | 'right' | 'center'
}) {
  const active = current === key
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  const justifyCls = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
  return (
    <th
      onClick={() => onSort(key)}
      className={`px-4 py-3 ${alignCls} text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700`}
    >
      <span className={`inline-flex items-center gap-1 ${justifyCls}`}>
        {label}
        {active
          ? (dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
          : <ChevronUp size={12} className="opacity-20" />}
      </span>
    </th>
  )
}
