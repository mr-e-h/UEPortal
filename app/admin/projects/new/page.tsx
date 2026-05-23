'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ParsedExcelResult } from '@/lib/excel'

type Form = {
  name: string
  project_number: string
  order_number: string
  customer: string
  county: string
  start_date: string
  end_date: string
}

const EMPTY_FORM: Form = {
  name: '',
  project_number: '',
  order_number: '',
  customer: '',
  county: '',
  start_date: '',
  end_date: '',
}

export default function NewProjectPage() {
  const router = useRouter()
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [excelData, setExcelData] = useState<ParsedExcelResult | null>(null)
  const [importLines, setImportLines] = useState(false)
  const [excelSuccess, setExcelSuccess] = useState(false)
  const [excelError, setExcelError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function set(key: keyof Form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleExcelFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.xlsx')) {
      setExcelError('Kun .xlsx-filer støttes')
      return
    }
    setUploading(true)
    setExcelError('')
    setExcelSuccess(false)

    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/projects/parse-excel', { method: 'POST', body: fd })

    if (!res.ok) {
      setExcelError('Kunne ikke lese Excel-filen')
      setUploading(false)
      return
    }

    const data = await res.json() as ParsedExcelResult
    setExcelData(data)
    setImportLines(true)
    setExcelSuccess(true)
    setForm((prev) => ({
      ...prev,
      project_number: data.project_number || prev.project_number,
      name: data.project_name || prev.name,
      order_number: data.order_number || prev.order_number,
    }))
    setUploading(false)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setLoading(true)
    let res: Response
    try {
      res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          status: 'active',
          import_excel: importLines && !!excelData,
          excel_data: importLines && excelData ? excelData.lines : undefined,
        }),
      })
    } catch {
      setLoading(false)
      setSubmitError('Nettverksfeil — prøv igjen')
      return
    }
    const data = await res.json().catch(() => ({} as Record<string, unknown>))
    if (!res.ok) {
      setLoading(false)
      const msg = typeof data === 'object' && data && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Kunne ikke opprette prosjekt'
      setSubmitError(msg)
      return
    }
    const project = data as { id?: string }
    if (!project.id) {
      setLoading(false)
      setSubmitError('Uventet svar fra serveren')
      return
    }
    router.push(`/admin/projects/${project.id}`)
  }

  return (
    <main className="px-4 sm:px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin" className="text-gray-400 hover:text-gray-600 text-sm">← Admin</Link>
        <h1 className="text-xl font-bold text-gray-900">Nytt prosjekt</h1>
      </div>

      {/* Excel upload */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <p className="text-sm font-medium text-gray-700 mb-3">Last opp Excel-underlag fra kunde (valgfritt)</p>
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files[0]
            if (file) handleExcelFile(file)
          }}
        >
          {uploading ? (
            <p className="text-sm text-blue-600">Leser Excel...</p>
          ) : excelData ? (
            <p className="text-sm text-green-600 font-medium">
              {excelData.lines.length} linjer klar for import · {excelData.project_name || 'Ukjent prosjektnavn'}
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-500">Dra og slipp .xlsx-fil hit, eller klikk for å velge</p>
              <p className="text-xs text-gray-400 mt-1">Forhåndsutfyller prosjektnummer, navn og ordrenummer</p>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleExcelFile(f) }}
        />

        {excelSuccess && (
          <div className="mt-3 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
            <span>✓</span>
            <span>Hentet prosjektinfo fra Excel — kontroller og juster ved behov</span>
          </div>
        )}
        {excelError && (
          <p className="mt-2 text-sm text-red-600">{excelError}</p>
        )}
      </div>

      {/* Project form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Prosjektnummer</label>
          <input
            type="text"
            required
            value={form.project_number}
            onChange={(e) => set('project_number', e.target.value)}
            className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Prosjektnavn</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ordrenummer</label>
          <input
            type="text"
            value={form.order_number}
            onChange={(e) => set('order_number', e.target.value)}
            className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Kunde</label>
          <input
            type="text"
            required
            value={form.customer}
            onChange={(e) => set('customer', e.target.value)}
            className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fylke</label>
          <input
            type="text"
            value={form.county}
            onChange={(e) => set('county', e.target.value)}
            className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {([['start_date', 'Startdato'], ['end_date', 'Sluttdato']] as const).map(([key, label]) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <input
                type="date"
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
                className="block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          ))}
        </div>

        {excelData && (
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={importLines}
              onChange={(e) => setImportLines(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded"
            />
            <span className="text-sm text-gray-700">
              Importer budsjettlinjer fra Excel-filen
              <span className="text-gray-400 ml-1">({excelData.lines.length} linjer)</span>
            </span>
          </label>
        )}

        {submitError && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {submitError}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Oppretter...' : 'Opprett prosjekt'}
          </button>
          <Link href="/admin" className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Avbryt</Link>
        </div>
      </form>
    </main>
  )
}
