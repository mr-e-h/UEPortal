'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Project, ProjectType } from '@/types'
import { Trash2 } from 'lucide-react'

type Form = {
  name: string
  project_number: string
  order_number: string
  customer: string
  county: string
  status: string
  start_date: string
  end_date: string
  project_type_id: string
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Aktiv' },
  { value: 'completed', label: 'Fullført' },
  { value: 'archived', label: 'Arkivert' },
]

export default function EditProjectPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [form, setForm] = useState<Form | null>(null)
  const [types, setTypes] = useState<ProjectType[]>([])
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    fetch('/api/projects').then((r) => r.json()).then((projects: Project[]) => {
      const p = projects.find((x) => x.id === id)
      if (!p) return
      setForm({
        name: p.name,
        project_number: p.project_number,
        order_number: p.order_number ?? '',
        customer: p.customer,
        county: p.county,
        status: p.status,
        start_date: p.start_date ?? '',
        end_date: p.end_date ?? '',
        project_type_id: p.project_type_id ?? '',
      })
    })
    fetch('/api/project-types')
      .then((r) => r.ok ? r.json() : [])
      .then((data: ProjectType[]) => Array.isArray(data) && setTypes(data))
      .catch(() => {})
  }, [id])

  function set(key: keyof Form, value: string) {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setSaving(true)
    await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        // Empty select = null in DB so the optional FK stays unset.
        project_type_id: form.project_type_id || null,
      }),
    })
    router.push(`/admin/projects/${id}`)
  }

  async function handleDelete() {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    router.push('/admin')
  }

  if (!form) return <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Laster...</div>

  const fields: { key: keyof Form; label: string; type?: string; required?: boolean }[] = [
    { key: 'project_number', label: 'Prosjektnummer', required: true },
    { key: 'name', label: 'Prosjektnavn', required: true },
    { key: 'order_number', label: 'Ordrenummer' },
    { key: 'customer', label: 'Kunde', required: true },
    { key: 'county', label: 'Fylke' },
  ]

  return (
    <main className="px-4 sm:px-6 py-8 max-w-2xl">
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl mx-4">
            <h2 className="font-semibold text-[var(--color-text-primary)] mb-2">Flytt til papirkurv?</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              Prosjektet flyttes til papirkurven og kan gjenopprettes fra Papirkurv i admin-menyen.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDeleteConfirm(false)} className="text-sm px-3 py-1.5 border border-border rounded hover:bg-muted">
                Avbryt
              </button>
              <button onClick={handleDelete} className="text-sm px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700">
                Flytt til papirkurv
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link href={`/admin/projects/${id}`} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-sm">← Tilbake</Link>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Rediger prosjekt</h1>
        </div>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="flex items-center gap-1.5 text-sm text-red-600 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50 transition-colors"
        >
          <Trash2 size={13} />
          Slett prosjekt
        </button>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
        {fields.map(({ key, label, required }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{label}</label>
            <input
              type="text"
              required={required}
              value={form[key]}
              onChange={(e) => set(key, e.target.value)}
              className="block w-full px-3 py-2 text-[var(--color-text-primary)] border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        ))}

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Status</label>
          <select
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
            className="block w-full px-3 py-2 text-[var(--color-text-primary)] border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Type prosjekt</label>
          <select
            value={form.project_type_id}
            onChange={(e) => set('project_type_id', e.target.value)}
            className="block w-full px-3 py-2 text-[var(--color-text-primary)] border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">– Ingen type –</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Brukes til å generere standard sjekkliste på prosjektet. Endre type påvirker ikke eksisterende sjekkliste — generer den på nytt fra Sjekkliste-fanen.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {([['start_date', 'Startdato'], ['end_date', 'Sluttdato']] as const).map(([key, label]) => (
            <div key={key}>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{label}</label>
              <input
                type="date"
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
                className="block w-full px-3 py-2 text-[var(--color-text-primary)] border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Lagrer...' : 'Lagre endringer'}
          </button>
          <Link href={`/admin/projects/${id}`} className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
            Avbryt
          </Link>
        </div>
      </form>
    </main>
  )
}
