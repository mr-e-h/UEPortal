'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { ChangeOrder } from '@/types'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import NumberInput from '@/components/NumberInput'

type UEChangeOrder = Omit<ChangeOrder, 'customer_price_snapshot' | 'total_customer_value' | 'profit'>

type BudgetLineOption = {
  product_id: string
  product_name: string
  unit: string
  cost_price?: number
}

type Props = {
  projectId: string
  subcontractorId: string
  budgetLines: BudgetLineOption[]
  initialDraft?: UEChangeOrder
  onClose: () => void
  onSuccess: () => void
}

function fmt(n: number) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(n)
}

export default function ChangeOrderModal({
  projectId,
  subcontractorId,
  budgetLines,
  initialDraft,
  onClose,
  onSuccess,
}: Props) {
  const [productId, setProductId] = useState(
    initialDraft?.product_id ?? budgetLines[0]?.product_id ?? ''
  )
  const [quantity, setQuantity] = useState(
    initialDraft ? String(initialDraft.requested_quantity) : ''
  )
  const [reason, setReason] = useState(initialDraft?.reason ?? '')
  const [solution, setSolution] = useState(initialDraft?.solution ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | null>(
    initialDraft?.attachment_url ?? null
  )
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)

  const applyFile = useCallback((f: File) => {
    if (!f.type.startsWith('image/') && f.type !== 'application/pdf') {
      setError('Kun bilder og PDF-filer er støttet.')
      return
    }
    // Match server limit (lib/upload-config.MAX_ATTACHMENT_BYTES = 10 MB).
    // Without this guard the user can drop a 50 MB file, wait through a
    // 60 MB JSON upload, and get a generic 413 with no preview.
    const MAX_BYTES = 10 * 1024 * 1024
    if (f.size > MAX_BYTES) {
      setError(`Filen er for stor (${(f.size / 1024 / 1024).toFixed(1)} MB). Maks 10 MB.`)
      return
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    const url = f.type.startsWith('image/') ? URL.createObjectURL(f) : null
    previewUrlRef.current = url
    setPreviewUrl(url)
    setFile(f)
    setExistingAttachmentUrl(null)
    setError('')
  }, [])

  function clearFile() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = null
    setPreviewUrl(null)
    setFile(null)
    setExistingAttachmentUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return
      const imageItem = Array.from(e.clipboardData.items).find((item) =>
        item.type.startsWith('image/')
      )
      if (!imageItem) return
      const f = imageItem.getAsFile()
      if (f) applyFile(f)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('paste', onPaste)
    }
  }, [onClose, applyFile])

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) applyFile(f)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) applyFile(f)
  }

  async function handleSave(action: 'pending' | 'draft') {
    if (action === 'pending') {
      const qty = Number(quantity)
      if (!productId || !quantity || isNaN(qty) || qty <= 0) {
        setError('Fyll ut alle påkrevde felt. Mengde må være et positivt tall.')
        return
      }
      if (!reason.trim()) {
        setError('Beskrivelse er påkrevd.')
        return
      }
    }

    setSubmitting(true)
    setError('')

    try {
      const qty = Number(quantity) || 0
      let orderId: string

      if (initialDraft) {
        const res = await fetch(`/api/change-orders/${initialDraft.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: productId,
            requested_quantity: qty,
            reason: reason.trim(),
            solution: solution.trim(),
            status: action,
          }),
        })
        if (!res.ok) {
          const data = await res.json() as { error?: string }
          setError(data.error ?? 'Oppdatering feilet')
          setSubmitting(false)
          return
        }
        const updated = await res.json() as { id: string }
        orderId = updated.id
      } else {
        const res = await fetch('/api/change-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            subcontractor_id: subcontractorId,
            product_id: productId,
            requested_quantity: qty,
            reason: reason.trim(),
            solution: solution.trim(),
            status: action,
          }),
        })
        if (!res.ok) {
          const data = await res.json() as { error?: string }
          setError(data.error ?? 'Innsending feilet')
          setSubmitting(false)
          return
        }
        const created = await res.json() as { id: string }
        orderId = created.id
      }

      if (file) {
        // Two-stage: read the file as base64, then POST. Either stage can fail;
        // surface real errors so the user can retry instead of seeing a silent
        // success (EM was created but attachment never uploaded).
        await new Promise<void>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = async () => {
            try {
              const res = await fetch(`/api/change-orders/${orderId}/attachment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  filename: file.name,
                  data: reader.result as string,
                  mimeType: file.type,
                }),
              })
              if (!res.ok) {
                const data = await res.json().catch(() => ({} as { error?: string }))
                reject(new Error(data.error ?? `Vedlegg-opplasting feilet (${res.status})`))
                return
              }
              resolve()
            } catch (err) {
              reject(err)
            }
          }
          reader.onerror = () => reject(reader.error ?? new Error('Klarte ikke lese filen'))
          reader.readAsDataURL(file)
        })
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen.')
      setSubmitting(false)
    }
  }

  const hasAttachment = file !== null || existingAttachmentUrl !== null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            {initialDraft ? 'Rediger kladd' : 'Send endringsmelding'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-xl leading-none"
            aria-label="Lukk"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
              Produkt <span className="text-danger">*</span>
            </label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-primary"
            >
              {budgetLines.map((bl) => (
                <option key={bl.product_id} value={bl.product_id}>
                  {bl.product_name} ({bl.unit})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
              Ekstra mengde <span className="text-danger">*</span>
            </label>
            <NumberInput
              value={quantity}
              onChange={(raw) => setQuantity(raw)}
              placeholder="0"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-primary"
            />
            {(() => {
              const selectedLine = budgetLines.find((bl) => bl.product_id === productId)
              const unitPrice = selectedLine?.cost_price ?? 0
              const qty = Number(quantity) || 0
              if (qty <= 0) return null
              return (
                <div className={`mt-2 px-3 py-2 rounded-lg text-sm flex items-center justify-between ${
                  unitPrice > 0 ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'
                }`}>
                  <span className={unitPrice > 0 ? 'text-green-700' : 'text-orange-700'}>
                    {unitPrice > 0
                      ? `Estimert sum: ${unitPrice.toLocaleString('nb-NO')} × ${qty} ${selectedLine?.unit ?? ''}`
                      : 'Pris ikke satt — sum beregnes av administrator'}
                  </span>
                  {unitPrice > 0 && (
                    <span className="font-semibold text-green-800">{fmt(unitPrice * qty)}</span>
                  )}
                </div>
              )
            })()}
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
              Beskrivelse <span className="text-danger">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Hva er endringen?"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-primary resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
              Løsning
            </label>
            <textarea
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              rows={3}
              placeholder="Hvordan løses det / hva blir gjort?"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-primary resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
              Vedlegg (valgfritt)
            </label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded-lg border-2 p-4 text-center transition-colors ${
                isDragOver
                  ? 'border-primary bg-primary-soft'
                  : 'border-dashed border-gray-300 bg-[var(--color-bg-muted)]'
              }`}
            >
              {hasAttachment ? (
                <div className="space-y-2">
                  {file && previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Forhåndsvisning"
                      className="max-h-36 max-w-full mx-auto rounded object-contain"
                    />
                  ) : file ? (
                    <div className="flex items-center justify-center gap-2">
                      <svg
                        className="w-8 h-8 text-red-500 flex-none"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                        />
                      </svg>
                      <span className="text-sm text-[var(--color-text-secondary)] truncate max-w-[220px]">
                        {file.name}
                      </span>
                    </div>
                  ) : existingAttachmentUrl ? (
                    <div className="flex items-center justify-center gap-2">
                      <svg
                        className="w-5 h-5 text-gray-400 flex-none"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
                        />
                      </svg>
                      <a
                        href={initialDraft ? `/api/change-orders/${initialDraft.id}/attachment?redirect=1` : '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-blue-600 hover:underline truncate max-w-[220px]"
                      >
                        Eksisterende vedlegg
                      </a>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={clearFile}
                    className="text-xs text-[var(--color-text-muted)] hover:text-red-600 transition-colors"
                  >
                    Fjern vedlegg
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Dra fil hit eller lim inn bilde (Ctrl+V)
                  </p>
                  <label className="cursor-pointer inline-block">
                    <span className="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-[var(--color-text-primary)] transition-colors">
                      Velg fil
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleFileInput}
                      className="sr-only"
                    />
                  </label>
                  <p className="text-xs text-[var(--color-text-muted)]">Bilder (JPG, PNG, …) eller PDF</p>
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 justify-end pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Avbryt
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleSave('draft')}
              disabled={submitting}
            >
              {submitting ? 'Lagrer…' : 'Lagre som kladd'}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => handleSave('pending')}
              disabled={submitting}
            >
              {submitting ? 'Sender inn…' : 'Send endringsmelding'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
