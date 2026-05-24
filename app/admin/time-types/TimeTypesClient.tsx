'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { TimeType, Subcontractor, SubcontractorProductPrice } from '@/types'
import SortableTable from '@/components/SortableTable'
import NumberInput from '@/components/NumberInput'
import { fmtNOK as fmt } from '@/lib/format'
import Field from '@/components/ui/Field'
import StatusPill from '@/components/ui/StatusPill'
import Button from '@/components/ui/Button'

interface Props {
  initialTimeTypes: TimeType[]
  initialSubcontractors: Subcontractor[]
  initialSubPrices: SubcontractorProductPrice[]
}

export default function TimeTypesClient({
  initialTimeTypes,
  initialSubcontractors,
  initialSubPrices,
}: Props) {
  const router = useRouter()
  const [timeTypes, setTimeTypes] = useState<TimeType[]>(initialTimeTypes)
  const [subcontractors] = useState<Subcontractor[]>(initialSubcontractors)
  const [subPrices] = useState<SubcontractorProductPrice[]>(initialSubPrices)

  const [newType, setNewType] = useState({ name: '', cost_per_hour: '' })
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState({ name: '', cost_per_hour: '' })

  const [selectedSubId, setSelectedSubId] = useState('')
  const [innleieForm, setInnleieForm] = useState({ name: '', cost_per_hour: '' })
  const [savingInnleie, setSavingInnleie] = useState(false)

  // Subs + prices are read-only here (managed on other pages). Only time-types
  // mutate locally, so we re-fetch just that list after writes.
  const fetchAll = useCallback(async () => {
    const tts = await fetch('/api/time-types').then((r) => r.ok ? r.json() : [])
    setTimeTypes(Array.isArray(tts) ? tts : [])
    router.refresh()
  }, [router])

  function selectSub(subId: string) {
    setSelectedSubId(subId)
    if (!subId) {
      setInnleieForm({ name: '', cost_per_hour: '' })
      return
    }
    const sub = subcontractors.find((s) => s.id === subId)
    const prices = subPrices.filter((p) => p.subcontractor_id === subId)
    const avgCost = prices.length > 0 ? Math.round(prices.reduce((s, p) => s + p.cost_price, 0) / prices.length) : 0
    setInnleieForm({ name: `Innleie: ${sub?.company_name ?? ''}`, cost_per_hour: String(avgCost) })
  }

  async function addTimeType(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/time-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newType.name, cost_per_hour: Number(newType.cost_per_hour) }),
    })
    setNewType({ name: '', cost_per_hour: '' })
    setSaving(false)
    fetchAll()
  }

  async function saveEdit(id: string) {
    await fetch(`/api/time-types/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editValues.name, cost_per_hour: Number(editValues.cost_per_hour) }),
    })
    setEditingId(null)
    fetchAll()
  }

  async function toggleActive(id: string, active: boolean) {
    await fetch(`/api/time-types/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    })
    fetchAll()
  }

  async function addInnleieType(e: React.FormEvent) {
    e.preventDefault()
    setSavingInnleie(true)
    await fetch('/api/time-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: innleieForm.name, cost_per_hour: Number(innleieForm.cost_per_hour) }),
    })
    setSelectedSubId('')
    setInnleieForm({ name: '', cost_per_hour: '' })
    setSavingInnleie(false)
    fetchAll()
  }

  // Initial data shipped server-side; no loading flash.

  const ttColumns = [
    {
      key: 'name',
      label: 'Navn',
      sortable: true,
      render: (row: TimeType) =>
        editingId === row.id
          ? <input value={editValues.name} onChange={(e) => setEditValues((p) => ({ ...p, name: e.target.value }))} className="px-2 py-1 text-sm border border-gray-300 rounded w-48 focus:outline-none focus:ring-blue-500" />
          : <span className={row.active ? 'text-gray-900' : 'text-gray-400 line-through'}>{row.name}</span>,
    },
    {
      key: 'cost_per_hour',
      label: 'Timekostnad',
      sortable: true,
      render: (row: TimeType) =>
        editingId === row.id
          ? <NumberInput value={editValues.cost_per_hour} onChange={(raw) => setEditValues((p) => ({ ...p, cost_per_hour: raw }))} className="px-2 py-1 text-sm border border-gray-300 rounded w-28 focus:outline-none focus:ring-blue-500" />
          : fmt(row.cost_per_hour),
    },
    {
      key: 'active',
      label: 'Status',
      sortable: true,
      render: (row: TimeType) => (
        <StatusPill tone={row.active ? 'green' : 'gray'}>
          {row.active ? 'Aktiv' : 'Inaktiv'}
        </StatusPill>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (row: TimeType) =>
        editingId === row.id ? (
          <div className="flex gap-2">
            <button onClick={() => saveEdit(row.id)} className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Lagre</button>
            <button onClick={() => setEditingId(null)} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200">Avbryt</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => { setEditingId(row.id); setEditValues({ name: row.name, cost_per_hour: String(row.cost_per_hour) }) }}
              className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200"
            >
              Rediger
            </button>
            <button
              onClick={() => toggleActive(row.id, row.active)}
              className={`px-2 py-1 text-xs rounded ${row.active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
            >
              {row.active ? 'Deaktiver' : 'Aktiver'}
            </button>
          </div>
        ),
    },
  ]

  return (
    <main className="px-4 sm:px-6 py-8 space-y-8">
      <h1 className="text-xl font-bold text-gray-900">Timetyper</h1>

      {/* Section 1: Interntyper */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Interntyper</h2>
        <form onSubmit={addTimeType} className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-4 items-end mb-4">
          <Field label="Navn">
            <input
              required
              value={newType.name}
              onChange={(e) => setNewType((p) => ({ ...p, name: e.target.value }))}
              className="px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-blue-500 w-48"
              placeholder="F.eks. Prosjektleder"
            />
          </Field>
          <Field label="Timekostnad (kr)">
            <NumberInput
              required
              value={newType.cost_per_hour}
              onChange={(raw) => setNewType((p) => ({ ...p, cost_per_hour: raw }))}
              className="px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-blue-500 w-28"
              placeholder="950"
            />
          </Field>
          <Button type="submit" disabled={saving}>
            {saving ? 'Lagrer...' : '+ Legg til'}
          </Button>
        </form>
        <div className="bg-white rounded-lg shadow">
          <SortableTable columns={ttColumns} data={timeTypes} emptyText="Ingen timetyper ennå" />
        </div>
      </section>

      {/* Section 2: UE-innleie timer */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">UE-innleie timer</h2>
        <p className="text-sm text-gray-500 mb-3">Legg til timetype for innleid UE — navn og kostnad foreslås automatisk fra snittprisen.</p>
        <form onSubmit={addInnleieType} className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-wrap gap-4 items-end">
          <Field label="Underentreprenør">
            <select
              value={selectedSubId}
              onChange={(e) => selectSub(e.target.value)}
              className="text-sm text-gray-900 border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-blue-500"
            >
              <option value="">Velg UE</option>
              {subcontractors.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.company_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Navn">
            <input
              required
              value={innleieForm.name}
              onChange={(e) => setInnleieForm((p) => ({ ...p, name: e.target.value }))}
              className="px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-blue-500 w-48"
            />
          </Field>
          <Field label="Timekostnad (kr)">
            <NumberInput
              required
              value={innleieForm.cost_per_hour}
              onChange={(raw) => setInnleieForm((p) => ({ ...p, cost_per_hour: raw }))}
              className="px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-blue-500 w-28"
            />
          </Field>
          <Button type="submit" disabled={savingInnleie || !selectedSubId}>
            {savingInnleie ? 'Lagrer...' : '+ Legg til'}
          </Button>
        </form>
      </section>
    </main>
  )
}
