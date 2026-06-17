'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { ChangeOrder, ActivityEntry } from '@/types'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import NumberInput from '@/components/NumberInput'
import VersionDiffModal from '@/components/admin/VersionDiffModal'

// API beriker med has_admin_edits + has_consequence_lines etter UE-strip
// (se app/api/subcontractor/change-orders/route.ts).
type UEChangeOrder = Omit<ChangeOrder, 'customer_price_snapshot' | 'total_customer_value' | 'profit'> & {
  has_admin_edits?: boolean
  has_consequence_lines?: boolean
}

// Konsekvens-linje slik UE ser den — customer_price_snapshot er strippet
// ut av /api/change-orders/[id]/consequence-lines for UE.
type UEConsequenceLine = {
  id: string
  product_id: string
  quantity: number
  unit: string
  cost_price_snapshot: number
  sort_order: number
}

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
  const [emType, setEmType] = useState<'economic' | 'spec_deviation' | 'time'>(
    initialDraft?.em_type ?? 'economic',
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
  // Persistert id for EMen som ble lagret/sendt i steg 1. Settes så snart
  // POST/PUT er OK, slik at et nytt «Send»-klikk (eller «Last opp på nytt»)
  // gjenbruker SAMME EM i stedet for å opprette en duplikat. Initialiseres
  // fra en eventuell kladd vi åpnet for redigering.
  const [savedOrderId, setSavedOrderId] = useState<string | null>(
    initialDraft?.id ?? null
  )
  // True når EMen er lagret men vedlegget feilet i steg 2. Da viser vi en
  // målrettet «Last opp på nytt»-knapp i stedet for å lage ny EM.
  const [attachmentFailed, setAttachmentFailed] = useState(false)
  // Egen submitting-flag for den isolerte vedlegg-re-opplastingen.
  const [retryingAttachment, setRetryingAttachment] = useState(false)
  // Konsekvens-linjer for read-only-visning når EMen åpnes. Lastes lazy
  // når modal åpnes med en eksisterende EM som har has_consequence_lines.
  // Customer-pris er strippet ut av endepunktet.
  const [consequenceLines, setConsequenceLines] = useState<UEConsequenceLine[]>([])
  // Siste 'edited'-rad fra activity_log for diff-popup når UE klikker
  // "Se endringer". /api/activity strip-er customer-felter rekursivt.
  const [diffEntry, setDiffEntry] = useState<ActivityEntry | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)

  // Hent konsekvens-linjer når modal åpnes for en eksisterende EM som
  // har dem. UE skal se hva som vil bli trukket fra prosjektet hvis
  // EMen avvises — read-only.
  useEffect(() => {
    if (!initialDraft?.id || !initialDraft.has_consequence_lines) return
    let cancelled = false
    fetch(`/api/change-orders/${initialDraft.id}/consequence-lines`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setConsequenceLines(Array.isArray(data) ? data : [])
      })
      .catch(() => { /* stille — read-only-blokken vises ikke uten data */ })
    return () => { cancelled = true }
  }, [initialDraft?.id, initialDraft?.has_consequence_lines])

  async function openLatestEdit() {
    if (!initialDraft?.id) return
    setLoadingDiff(true)
    try {
      const res = await fetch(`/api/activity?entity_id=${initialDraft.id}&entity_type=change_order`)
      if (!res.ok) return
      const all = (await res.json()) as ActivityEntry[]
      const lastEdited = [...all].reverse().find((e) => e.action === 'edited')
      if (lastEdited) setDiffEntry(lastEdited)
    } finally {
      setLoadingDiff(false)
    }
  }

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
    // Nytt vedlegg valgt etter en steg 2-feil → nullstill feiltilstanden
    // så «Send» igjen kjører normalflyten (PUT + vedlegg) på samme EM.
    setAttachmentFailed(false)
  }, [])

  function clearFile() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = null
    setPreviewUrl(null)
    setFile(null)
    setExistingAttachmentUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    // Uten fil gir «Last opp på nytt» ingen mening — fjern feilbanneren.
    setAttachmentFailed(false)
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

  // Steg 2, isolert: POST KUN til /attachment for en allerede lagret EM.
  // Brukes både i normalflyten og av «Last opp på nytt». Kaster ved feil
  // slik at kalleren kan skille steg 1 fra steg 2.
  async function uploadAttachment(orderId: string, f: File) {
    await new Promise<void>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const res = await fetch(`/api/change-orders/${orderId}/attachment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: f.name,
              data: reader.result as string,
              mimeType: f.type,
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
      reader.readAsDataURL(f)
    })
  }

  // «Last opp på nytt» etter at steg 1 lyktes men steg 2 feilet. POSTer KUN
  // vedlegget for den allerede lagrede EMen — ingen ny POST/PUT av selve EMen,
  // så ingen duplikat. Ved suksess fullføres flyten med onSuccess().
  async function handleRetryAttachment() {
    if (!savedOrderId || !file) return
    setRetryingAttachment(true)
    setError('')
    try {
      await uploadAttachment(savedOrderId, file)
      setAttachmentFailed(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vedlegget kunne ikke lastes opp. Prøv igjen.')
      setRetryingAttachment(false)
    }
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
    setAttachmentFailed(false)

    try {
      const qty = Number(quantity) || 0

      // Steg 1: lagre/send selve EMen. PUT hvis vi alt har en id (åpnet kladd
      // ELLER en EM vi nettopp opprettet og som vedlegget feilet på) — slik
      // unngår vi en duplikat-EM når UE klikker «Send» på nytt etter steg 2-feil.
      let orderId: string
      if (savedOrderId) {
        const res = await fetch(`/api/change-orders/${savedOrderId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: productId,
            requested_quantity: qty,
            reason: reason.trim(),
            solution: solution.trim(),
            em_type: emType,
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
            em_type: emType,
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
      // Steg 1 lyktes: behold id-en så et nytt klikk PUT-er (ikke POST-er).
      setSavedOrderId(orderId)

      // Steg 2: vedlegget. Feiler dette er EMen ALLEREDE lagret — ikke kall
      // onSuccess(); behold orderId og vis «Last opp på nytt» slik at UE kun
      // re-POSTer vedlegget mot samme EM. Ingen duplikat-EM.
      if (file) {
        try {
          await uploadAttachment(orderId, file)
        } catch (err) {
          setAttachmentFailed(true)
          setError(err instanceof Error ? err.message : 'Vedlegget kunne ikke lastes opp.')
          setSubmitting(false)
          return
        }
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
            {initialDraft?.status === 'revision_requested'
              ? 'Revider endringsmelding'
              : initialDraft
                ? 'Rediger kladd'
                : 'Send endringsmelding'}
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
          {/* Admin-kommentar når EMen er returnert til revisjon — vises øverst
              så UE leser hva som mangler før de begynner å redigere. */}
          {initialDraft?.status === 'revision_requested' && initialDraft.admin_comment && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-orange-900 uppercase tracking-wide mb-1">
                Admin har bedt om revisjon
              </p>
              <p className="text-sm text-orange-900 whitespace-pre-line">{initialDraft.admin_comment}</p>
            </div>
          )}

          {/* Endret-av-prosjektleder-banner. Vises når den åpnede EMen har
              minst én 'edited'-rad i activity_log. Knappen åpner
              VersionDiffModal med siste edit-snapshot (UE-strippet). */}
          {initialDraft?.has_admin_edits && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-purple-900 uppercase tracking-wide mb-1">
                  Endret av prosjektleder
                </p>
                <p className="text-sm text-purple-900">
                  Denne endringsmeldingen er justert av prosjektleder. Du kan se hva som er endret i versjonsloggen.
                </p>
              </div>
              <button
                type="button"
                onClick={openLatestEdit}
                disabled={loadingDiff}
                className="flex-none text-xs font-medium text-purple-700 hover:text-purple-900 underline disabled:opacity-50"
              >
                Se endringer
              </button>
            </div>
          )}

          {/* Konsekvens ved avslag — read-only seksjon. Customer-pris er
              strippet av endepunktet. UE skal kun se hva som vil bli
              trukket, ikke kunde-/salgsverdier. */}
          {initialDraft?.has_consequence_lines && consequenceLines.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-orange-900 uppercase tracking-wide mb-1">
                Konsekvens ved avslag
              </p>
              <p className="text-xs text-orange-700 mb-2">
                Dersom endringsmeldingen avslås, kan følgende trekkes ut eller ikke gjennomføres:
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-orange-700">
                    <th className="py-1 font-medium">Produkt</th>
                    <th className="py-1 font-medium text-right">Mengde</th>
                  </tr>
                </thead>
                <tbody>
                  {consequenceLines.map((cl) => {
                    const bl = budgetLines.find((b) => b.product_id === cl.product_id)
                    return (
                      <tr key={cl.id}>
                        <td className="py-1 text-orange-900">
                          {bl?.product_name ?? cl.product_id}
                        </td>
                        <td className="py-1 text-right tabular-nums text-orange-900">
                          − {cl.quantity} <span className="text-orange-600">{cl.unit}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
              Type <span className="text-danger">*</span>
            </label>
            <select
              value={emType}
              onChange={(e) => setEmType(e.target.value as 'economic' | 'spec_deviation' | 'time')}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:border-primary"
            >
              <option value="economic">Økonomisk</option>
              <option value="spec_deviation">Avvik kravspec</option>
              <option value="time">Tid</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
              Produkt <span className="text-danger">*</span>
            </label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:border-primary"
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
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:border-primary"
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
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:border-primary resize-none"
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
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:border-primary resize-none"
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
                  : 'border-dashed border-border bg-[var(--color-bg-muted)]'
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
                        className="w-5 h-5 text-[var(--color-text-muted)] flex-none"
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
                    <span className="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-white border border-border rounded-lg hover:bg-muted text-[var(--color-text-primary)] transition-colors">
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

          {/* Vedlegg feilet i steg 2, men EMen er lagret. Egen rød banner med
              målrettet «Last opp på nytt» som KUN re-POSTer vedlegget mot den
              allerede lagrede EMen — så UE ikke trykker «Send» på nytt og lager
              en duplikat. Selve «Send»-knappen vil uansett PUT-e (savedOrderId
              er satt), så også den veien er duplikat-sikker. */}
          {attachmentFailed ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-red-800">
                Endringsmeldingen er lagret, men vedlegget ble ikke lastet opp.
              </p>
              {error && <p className="text-xs text-red-700">{error}</p>}
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleRetryAttachment}
                  disabled={retryingAttachment || !file}
                >
                  {retryingAttachment ? 'Laster opp…' : 'Last opp på nytt'}
                </Button>
                <button
                  type="button"
                  onClick={onSuccess}
                  disabled={retryingAttachment}
                  className="text-xs font-medium text-red-700 hover:text-red-900 underline disabled:opacity-50"
                >
                  Fortsett uten vedlegg
                </button>
              </div>
            </div>
          ) : (
            error && <p className="text-sm text-red-600">{error}</p>
          )}

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
              {submitting
                ? 'Sender inn…'
                : initialDraft?.status === 'revision_requested'
                  ? 'Send revidert versjon'
                  : 'Send endringsmelding'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Versjonsdiff-popup nestet i samme overlay — åpnes når UE
          klikker "Se endringer". Lukkes med X eller utenfor-klikk uten
          å lukke selve EM-modalen. productNameLookup går via budgetLines
          så produkt-IDer rendres som lesbare 'KODE - Navn'-strenger. */}
      <VersionDiffModal
        entry={diffEntry}
        productNameLookup={(id) => budgetLines.find((b) => b.product_id === id)?.product_name ?? id}
        onClose={() => setDiffEntry(null)}
      />
    </div>
  )
}
