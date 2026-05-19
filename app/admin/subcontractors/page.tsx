'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import type { Subcontractor, Product, SubcontractorProductPrice, User } from '@/types'
import { roleLabel } from '@/lib/roles'

type SortKey = 'company_name' | 'contact_person' | 'county' | 'prices'
type SortDir = 'asc' | 'desc'

const empty = { company_name: '', contact_person: '', email: '', phone: '', organization_number: '', county: '', active: true }

export default function SubcontractorsPage() {
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [prices, setPrices] = useState<SubcontractorProductPrice[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('company_name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const fetchAll = useCallback(async () => {
    const [subs, prods, prs, usrsRaw] = await Promise.all([
      fetch('/api/subcontractors').then((r) => r.json()),
      fetch('/api/products').then((r) => r.json()),
      fetch('/api/subcontractor-prices').then((r) => r.json()),
      fetch('/api/users').then((r) => r.ok ? r.json() : []),
    ])
    setSubcontractors(Array.isArray(subs) ? subs : [])
    setProducts(Array.isArray(prods) ? prods : [])
    setPrices(Array.isArray(prs) ? prs : [])
    setUsers(Array.isArray(usrsRaw) ? usrsRaw : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/subcontractors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setForm(empty)
    setShowForm(false)
    setSaving(false)
    fetchAll()
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Laster...</div>

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-900">Underentreprenører</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          {showForm ? 'Avbryt' : '+ Legg til UE'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-blue-50 border border-blue-200 rounded-lg p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { key: 'company_name', label: 'Firmanavn', required: true },
            { key: 'contact_person', label: 'Kontaktperson', required: false },
            { key: 'email', label: 'E-post', required: false },
            { key: 'phone', label: 'Telefon', required: false },
            { key: 'organization_number', label: 'Org.nr', required: false },
            { key: 'county', label: 'Fylke', required: false },
          ].map(({ key, label, required }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
              <input
                type="text"
                required={required}
                value={form[key as keyof typeof form] as string}
                onChange={(e) => set(key as keyof typeof form, e.target.value)}
                className="block w-full px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          ))}
          <div className="col-span-full">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Lagrer...' : 'Lagre underentreprenør'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="w-8 px-4 py-3" />
              {([['company_name', 'Firma'], ['contact_person', 'Kontakt']] as [SortKey, string][]).map(([key, label]) => (
                <th key={key} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort(key)}>
                  <span className="inline-flex items-center gap-1">
                    {label}
                    {sortKey === key ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronUp size={12} className="opacity-20" />}
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">E-post</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Telefon</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort('county')}>
                <span className="inline-flex items-center gap-1">
                  Fylke
                  {sortKey === 'county' ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronUp size={12} className="opacity-20" />}
                </span>
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort('prices')}>
                <span className="inline-flex items-center gap-1">
                  Priser
                  {sortKey === 'prices' ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronUp size={12} className="opacity-20" />}
                </span>
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {subcontractors.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">
                  Ingen underentreprenører ennå
                </td>
              </tr>
            ) : (
              [...subcontractors].sort((a, b) => {
                let cmp = 0
                if (sortKey === 'company_name') cmp = a.company_name.localeCompare(b.company_name, 'nb')
                else if (sortKey === 'contact_person') cmp = (a.contact_person ?? '').localeCompare(b.contact_person ?? '', 'nb')
                else if (sortKey === 'county') cmp = (a.county ?? '').localeCompare(b.county ?? '', 'nb')
                else if (sortKey === 'prices') {
                  const missingA = products.filter((p) => !prices.find((x) => x.subcontractor_id === a.id && x.product_id === p.id)).length
                  const missingB = products.filter((p) => !prices.find((x) => x.subcontractor_id === b.id && x.product_id === p.id)).length
                  cmp = missingA - missingB
                }
                return sortDir === 'asc' ? cmp : -cmp
              }).map((s) => {
                const isExpanded = expanded === s.id
                const subUsers = users.filter((u) => u.subcontractor_id === s.id)
                const missingPrices = products.filter(
                  (p) => !prices.find((x) => x.subcontractor_id === s.id && x.product_id === p.id)
                ).length
                return (
                  <Fragment key={s.id}>
                    <tr
                      className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/40' : ''}`}
                      onClick={() => setExpanded(isExpanded ? null : s.id)}
                    >
                      <td className="px-4 py-3 text-gray-400">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">{s.company_name}</td>
                      <td className="px-4 py-3 text-gray-600">{s.contact_person}</td>
                      <td className="px-4 py-3 text-gray-600">{s.email}</td>
                      <td className="px-4 py-3 text-gray-600">{s.phone}</td>
                      <td className="px-4 py-3 text-gray-600">{s.county}</td>
                      <td className="px-4 py-3">
                        {s.active
                          ? <span className="text-xs text-green-600 font-medium">Aktiv</span>
                          : <span className="text-xs text-gray-400">Inaktiv</span>}
                      </td>
                      <td className="px-4 py-3">
                        {missingPrices > 0
                          ? <span className="text-xs text-orange-500">{missingPrices} mangler</span>
                          : <span className="text-xs text-green-600">Komplett</span>}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/admin/subcontractors/${s.id}/prices`}
                          className="text-blue-600 text-xs hover:underline"
                        >
                          Priser
                        </Link>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${s.id}-expanded`} className="bg-blue-50/20 border-b border-gray-100">
                        <td colSpan={9} className="px-6 py-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                            Brukere ({subUsers.length})
                          </p>
                          {subUsers.length === 0 ? (
                            <p className="text-sm text-gray-400">Ingen brukere koblet til denne UE</p>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              {subUsers.map((u) => (
                                <div key={u.id} className="flex items-center gap-3 text-sm">
                                  <span className="font-medium text-gray-900">{u.full_name}</span>
                                  <span className="text-gray-500">{u.email}</span>
                                  <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                    {roleLabel(u.role)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}
