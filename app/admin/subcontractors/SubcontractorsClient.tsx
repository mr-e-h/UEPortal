'use client'

import { useState, useCallback, useMemo, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import type { Subcontractor, User } from '@/types'
import { roleLabel } from '@/lib/roles'
import Field from '@/components/ui/Field'
import StatusPill from '@/components/ui/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'

type SortKey = 'company_name' | 'contact_person' | 'county' | 'prices'
type SortDir = 'asc' | 'desc'

export type SubWithMissing = Subcontractor & { missing_prices: number }

const empty = { company_name: '', contact_person: '', email: '', phone: '', organization_number: '', county: '', active: true }

interface Props {
  initialSubcontractors: SubWithMissing[]
}

export default function SubcontractorsClient({ initialSubcontractors }: Props) {
  const router = useRouter()
  const [subcontractors, setSubcontractors] = useState<SubWithMissing[]>(initialSubcontractors)
  const [users, setUsers] = useState<User[]>([])
  const [usersLoaded, setUsersLoaded] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('company_name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Re-fetch after a mutation (form submit). Uses the same overview endpoint
  // that the server-side initial load called — keeps the shape consistent.
  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/subcontractors-overview')
    const data = res.ok
      ? await res.json() as { subcontractors: SubWithMissing[]; product_count: number }
      : { subcontractors: [], product_count: 0 }
    setSubcontractors(Array.isArray(data.subcontractors) ? data.subcontractors : [])
  }, [])

  async function loadUsersIfNeeded() {
    if (usersLoaded) return
    const res = await fetch('/api/users')
    const data = res.ok ? await res.json() : []
    setUsers(Array.isArray(data) ? data : [])
    setUsersLoaded(true)
  }

  function toggleExpanded(id: string) {
    const next = expanded === id ? null : id
    setExpanded(next)
    if (next) loadUsersIfNeeded()
  }

  // Memoized sort so changing an unrelated piece of state (e.g. form input)
  // doesn't trigger a full re-sort.
  const sorted = useMemo(() => {
    const arr = [...subcontractors]
    arr.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'company_name') cmp = a.company_name.localeCompare(b.company_name, 'nb')
      else if (sortKey === 'contact_person') cmp = (a.contact_person ?? '').localeCompare(b.contact_person ?? '', 'nb')
      else if (sortKey === 'county') cmp = (a.county ?? '').localeCompare(b.county ?? '', 'nb')
      else if (sortKey === 'prices') cmp = a.missing_prices - b.missing_prices
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [subcontractors, sortKey, sortDir])

  // Per-UE user lists pre-grouped instead of re-filtering inside each render.
  const usersByUE = useMemo(() => {
    const m = new Map<string, User[]>()
    for (const u of users) {
      if (!u.subcontractor_id) continue
      const arr = m.get(u.subcontractor_id) ?? []
      arr.push(u)
      m.set(u.subcontractor_id, arr)
    }
    return m
  }, [users])

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
    await refresh()
    // Server-rendered count badges on other pages may also be stale.
    router.refresh()
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

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
            <Field key={key} label={label}>
              <input
                type="text"
                required={required}
                value={form[key as keyof typeof form] as string}
                onChange={(e) => set(key as keyof typeof form, e.target.value)}
                className="block w-full px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </Field>
          ))}
          <div className="col-span-full">
            <Button type="submit" disabled={saving}>
              {saving ? 'Lagrer...' : 'Lagre underentreprenør'}
            </Button>
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
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    title="Ingen underentreprenører ennå"
                    description="Trykk «Legg til UE» for å opprette den første."
                  />
                </td>
              </tr>
            ) : (
              sorted.map((s) => {
                const isExpanded = expanded === s.id
                const subUsers = usersByUE.get(s.id) ?? []
                const missingPrices = s.missing_prices
                return (
                  <Fragment key={s.id}>
                    <tr
                      className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/40' : ''}`}
                      onClick={() => toggleExpanded(s.id)}
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
                          ? <StatusPill tone="green">Aktiv</StatusPill>
                          : <StatusPill tone="gray">Inaktiv</StatusPill>}
                      </td>
                      <td className="px-4 py-3">
                        {missingPrices > 0
                          ? <StatusPill tone="amber">{missingPrices} mangler</StatusPill>
                          : <StatusPill tone="green">Komplett</StatusPill>}
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
                            Brukere {usersLoaded ? `(${subUsers.length})` : ''}
                          </p>
                          {!usersLoaded ? (
                            <p className="text-sm text-gray-400">Laster brukere...</p>
                          ) : subUsers.length === 0 ? (
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
