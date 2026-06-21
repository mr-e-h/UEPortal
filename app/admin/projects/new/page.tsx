'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ParsedExcelResult } from '@/lib/excel'
import Card from '@/components/ui/Card'
import Field from '@/components/ui/Field'
import ErrorBox from '@/components/ui/ErrorBox'
import Button from '@/components/ui/Button'

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
        <Link href="/admin" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-sm">← Admin</Link>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Nytt prosjekt</h1>
      </div>

      {/* Excel upload */}
      <Card className="p-6 mb-6">
        <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">Last opp Excel-underlag fra kunde (valgfritt)</p>
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-border hover:border-blue-400 hover:bg-muted'}`}
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
              <p className="text-sm text-[var(--color-text-muted)]">Dra og slipp .xlsx-fil hit, eller klikk for å velge</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Forhåndsutfyller prosjektnummer, navn og ordrenummer</p>
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
          <div className="mt-3">
            <ErrorBox variant="success">
              <span className="mr-1">✓</span>
              Hentet prosjektinfo fra Excel — kontroller og juster ved behov
            </ErrorBox>
          </div>
        )}
        {excelData && excelData.skipped.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            <p className="text-sm font-medium text-amber-800">
              {excelData.skipped.length} {excelData.skipped.length === 1 ? 'rad ble hoppet over' : 'rader ble hoppet over'} — kontroller at ingen av disse skulle vært med:
            </p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800 max-h-40 overflow-auto">
              {excelData.skipped.map((s, i) => (
                <li key={i}>Rad {s.row}: {s.name || s.code || '(uten navn)'} — {s.reason}</li>
              ))}
            </ul>
          </div>
        )}
        {excelError && (
          <p className="mt-2 text-sm text-red-600">{excelError}</p>
        )}
      </Card>

      {/* Project form */}
      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Prosjektnummer">
            <input
              type="text"
              required
              value={form.project_number}
              onChange={(e) => set('project_number', e.target.value)}
              className="block w-full px-3 py-2 text-[var(--color-text-primary)] border border-border rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </Field>
          <Field label="Prosjektnavn">
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="block w-full px-3 py-2 text-[var(--color-text-primary)] border border-border rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </Field>
          <Field label="Ordrenummer">
            <input
              type="text"
              value={form.order_number}
              onChange={(e) => set('order_number', e.target.value)}
              className="block w-full px-3 py-2 text-[var(--color-text-primary)] border border-border rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </Field>
          <Field label="Kunde">
            <input
              type="text"
              required
              value={form.customer}
              onChange={(e) => set('customer', e.target.value)}
              className="block w-full px-3 py-2 text-[var(--color-text-primary)] border border-border rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </Field>
          <Field label="Fylke">
            <input
              type="text"
              value={form.county}
              onChange={(e) => set('county', e.target.value)}
              className="block w-full px-3 py-2 text-[var(--color-text-primary)] border border-border rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            {([['start_date', 'Startdato'], ['end_date', 'Sluttdato']] as const).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="date"
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  className="block w-full px-3 py-2 text-[var(--color-text-primary)] border border-border rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </Field>
            ))}
          </div>

          {excelData && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={importLines}
                onChange={(e) => setImportLines(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-border rounded"
              />
              <span className="text-sm text-[var(--color-text-secondary)]">
                Importer budsjettlinjer fra Excel-filen
                <span className="text-[var(--color-text-muted)] ml-1">({excelData.lines.length} linjer)</span>
              </span>
            </label>
          )}

          {submitError && <ErrorBox>{submitError}</ErrorBox>}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={loading}>
              {loading ? 'Oppretter...' : 'Opprett prosjekt'}
            </Button>
            <Button variant="ghost" href="/admin">Avbryt</Button>
          </div>
        </form>
      </Card>
    </main>
  )
}
