'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Pencil, X, Save, Printer, History, Plus, Trash2 } from 'lucide-react'
import type { ChangeOrder, ChangeOrderLine, ChangeOrderConsequenceLine, Project, Product, Subcontractor, ActivityEntry } from '@/types'
import { fmtNOK as fmt, fmtProductLabel, fmtChangeOrderTitle } from '@/lib/format'
import { ADMIN_ROLES } from '@/lib/roles'
import { changeOrderType, changeOrderPill } from '@/lib/statuses'
import { activityActionLabel } from '@/lib/activity-actions'
import { useMe } from '@/lib/useMe'
import VersionDiffModal from '@/components/admin/VersionDiffModal'

/**
 * Admin EM-detail layout — two columns:
 *
 *   CENTER (col-span-9) Kundedel — the customer-facing slice (project,
 *                       product, qty, reason, attachment, salgsverdi).
 *                       Rediger + Eksporter PDF buttons sit IN this card
 *                       so they're discoverable next to the content they
 *                       affect. THIS card is what the PDF outputs.
 *
 *   RIGHT (col-span-3)  Stacked:
 *                         • Internt — kost + salgs + fortjeneste + margin
 *                         • Versjonslogg — diff trail of edits + status
 *                           changes (also visible to the UE on their side,
 *                           but the UE never sees customer-prices).
 *                       Both print:hidden.
 *
 * Eksporter PDF first POSTs to /mark-sent which stamps
 * change_orders.sent_to_customer_at = now and writes an audit row. The
 * status stays 'pending' but the dashboard pill flips from yellow
 * 'Ubehandlet' to blue 'Til behandling' so admin can see which pending
 * EMs are out at the customer.
 */

export default function ChangeOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { me } = useMe()
  const adminName = me?.full_name ?? 'Admin'
  // Byggeleder følger opp EM-er i lese-/oppfølgingsmodus: ingen kundepris/
  // fortjeneste/margin (allerede strippet server-side i /api/change-orders),
  // og ingen endelig godkjenn/avslå/send-til-kunde (API-ene 403'er uansett —
  // dette skjuler bare knappene/kortene). UE-kost vises.
  const canSeeEconomy = me ? ADMIN_ROLES.includes(me.role) : true
  const [co, setCo] = useState<ChangeOrder | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [sub, setSub] = useState<Subcontractor | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [exporting, setExporting] = useState(false)

  // EM lines — source of truth for product + qty in multi-line mode.
  const [lines, setLines] = useState<ChangeOrderLine[]>([])
  // "Konsekvens ved avslag" — admin/PM-definerte produktlinjer som trekkes
  // fra budsjettet hvis EMen avvises.
  const [consequenceLines, setConsequenceLines] = useState<ChangeOrderConsequenceLine[]>([])
  // Inline edit. Allowed for draft + pending (admin).
  // editLines drives the editable table; each row has product_id and qty.
  type EditLine = { tempId: string; product_id: string; requested_quantity: string }
  type EditConsequenceLine = { tempId: string; product_id: string; quantity: string }
  const [editing, setEditing] = useState(false)
  const [editLines, setEditLines] = useState<EditLine[]>([])
  const [editConsequenceLines, setEditConsequenceLines] = useState<EditConsequenceLine[]>([])
  const [editReason, setEditReason] = useState('')
  const [editSolution, setEditSolution] = useState('')
  const [editEmType, setEditEmType] = useState<'economic' | 'spec_deviation' | 'time'>('economic')
  const [editError, setEditError] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [revisionError, setRevisionError] = useState<string | null>(null)

  // Versjonslogg diff popup
  const [diffEntry, setDiffEntry] = useState<ActivityEntry | null>(null)
  const [products, setProducts] = useState<Product[]>([])

  const load = useCallback(async () => {
    const [orders, projects, products, subs, activityData, linesData, consequenceData] = await Promise.all([
      fetch(`/api/change-orders?id=${id}`).then((r) => r.json()),
      fetch('/api/projects').then((r) => r.json()),
      fetch('/api/products').then((r) => r.json()),
      fetch('/api/subcontractors').then((r) => r.json()),
      fetch(`/api/activity?entity_id=${id}&entity_type=change_order`).then((r) => r.json()),
      fetch(`/api/change-orders/${id}/lines`).then((r) => r.json()),
      fetch(`/api/change-orders/${id}/consequence-lines`).then((r) => r.json()),
    ])
    const found: ChangeOrder = orders[0] ?? null
    setCo(found)
    setProducts(Array.isArray(products) ? (products as Product[]) : [])
    if (found) {
      setProject((projects as Project[]).find((p) => p.id === found.project_id) ?? null)
      setSub((subs as Subcontractor[]).find((s) => s.id === found.subcontractor_id) ?? null)
      setComment(found.admin_comment ?? '')
    }
    setActivity(Array.isArray(activityData) ? activityData : [])
    setLines(Array.isArray(linesData) ? (linesData as ChangeOrderLine[]) : [])
    setConsequenceLines(Array.isArray(consequenceData) ? (consequenceData as ChangeOrderConsequenceLine[]) : [])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleStatus(status: 'approved' | 'rejected' | 'pending') {
    setSubmitting(true)
    await fetch(`/api/change-orders/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, admin_comment: comment || undefined, reviewed_by: adminName }),
    })
    await load()
    setSubmitting(false)
  }

  // Markerer EM som "til behandling" hos kunden uten å eksportere PDF.
  // Brukes når EMen er sendt ut via annen kanal (e-post, telefon) og
  // admin vil sette pillen til blå "Til behandling".
  async function markAsSent() {
    setSubmitting(true)
    await fetch(`/api/change-orders/${id}/mark-sent`, { method: 'POST' })
    await load()
    setSubmitting(false)
  }

  // Returnerer EMen tilbake til UE for revisjon. Statusen flippes til
  // 'revision_requested' og admin-kommentaren (samme tekstfelt som
  // Avvis/Godkjenn bruker) blir lagret så UE ser hva som mangler.
  async function requestRevision() {
    if (!comment.trim()) {
      // Krev kommentar — uten den vet ikke UE hva som mangler.
      setRevisionError('Skriv en kommentar som forklarer UE hva som mangler eller må endres.')
      return
    }
    setRevisionError(null)
    setSubmitting(true)
    await fetch(`/api/change-orders/${id}/request-revision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_comment: comment }),
    })
    await load()
    setSubmitting(false)
  }

  function startEdit() {
    if (!co) return
    const seed: EditLine[] = lines.length > 0
      ? lines.map((l) => ({
          tempId: l.id,
          product_id: l.product_id,
          requested_quantity: String(l.requested_quantity),
        }))
      : [{ tempId: crypto.randomUUID(), product_id: co.product_id, requested_quantity: String(co.requested_quantity) }]
    setEditLines(seed)
    // Seed konsekvens-linjene fra serverstaten — kan være tom liste.
    setEditConsequenceLines(
      consequenceLines.map((l) => ({
        tempId: l.id,
        product_id: l.product_id,
        quantity: String(l.quantity),
      })),
    )
    setEditReason(co.reason ?? '')
    setEditSolution(co.solution ?? '')
    setEditEmType(co.em_type ?? 'economic')
    setEditError(null)
    setEditing(true)
  }

  function addEditLine() {
    setEditLines((prev) => [
      ...prev,
      { tempId: crypto.randomUUID(), product_id: '', requested_quantity: '' },
    ])
  }

  function removeEditLine(tempId: string) {
    setEditLines((prev) => prev.length <= 1 ? prev : prev.filter((l) => l.tempId !== tempId))
  }

  function updateEditLine(tempId: string, patch: Partial<EditLine>) {
    setEditLines((prev) => prev.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l)))
  }

  // Konsekvens-linjer kan starte tom (ingen konsekvens definert).
  function addConsequenceLine() {
    setEditConsequenceLines((prev) => [
      ...prev,
      { tempId: crypto.randomUUID(), product_id: '', quantity: '' },
    ])
  }

  function removeConsequenceLine(tempId: string) {
    setEditConsequenceLines((prev) => prev.filter((l) => l.tempId !== tempId))
  }

  function updateConsequenceLine(tempId: string, patch: Partial<EditConsequenceLine>) {
    setEditConsequenceLines((prev) => prev.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l)))
  }

  async function saveEdit() {
    setEditSaving(true)
    setEditError(null)
    // Validate locally before round-tripping.
    const cleaned: Array<{ product_id: string; requested_quantity: number }> = []
    for (const ln of editLines) {
      if (!ln.product_id) {
        setEditError('Velg produkt på alle linjer')
        setEditSaving(false)
        return
      }
      const qty = Number(ln.requested_quantity)
      if (!Number.isFinite(qty) || qty <= 0) {
        setEditError('Mengde må være et positivt tall på hver linje')
        setEditSaving(false)
        return
      }
      cleaned.push({ product_id: ln.product_id, requested_quantity: qty })
    }
    // Konsekvens-linjer kan være tomme (ingen konsekvens definert) — vi
    // sender alltid arrayet så serveren vet at vi mente å replace-all.
    const cleanedConsequence: Array<{ product_id: string; quantity: number }> = []
    for (const ln of editConsequenceLines) {
      if (!ln.product_id) {
        setEditError('Velg produkt på alle konsekvens-linjer (eller fjern de tomme)')
        setEditSaving(false)
        return
      }
      const qty = Number(ln.quantity)
      if (!Number.isFinite(qty) || qty <= 0) {
        setEditError('Mengde må være et positivt tall på hver konsekvens-linje')
        setEditSaving(false)
        return
      }
      cleanedConsequence.push({ product_id: ln.product_id, quantity: qty })
    }
    const res = await fetch(`/api/change-orders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lines: cleaned,
        reason: editReason,
        solution: editSolution,
        em_type: editEmType,
        consequence_lines: cleanedConsequence,
      }),
    })
    setEditSaving(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setEditError(data.error ?? 'Lagring feilet')
      return
    }
    setEditing(false)
    await load()
  }

  async function exportPDF() {
    // Mark-as-sent first, THEN print. If the user cancels the print
    // dialog the flag still stays — that's fine, exporting at all is
    // strong enough signal that admin sent it out.
    setExporting(true)
    if (co?.status === 'pending' && !co.sent_to_customer_at) {
      try {
        await fetch(`/api/change-orders/${id}/mark-sent`, { method: 'POST' })
        await load()
      } catch { /* still allow print even if flagging fails */ }
    }
    setExporting(false)
    // setTimeout so the state update (sent_to_customer_at) has a tick to
    // flow into the rendered PDF before print fires.
    setTimeout(() => window.print(), 50)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[var(--color-text-muted)]">Laster...</div>
  if (!co) return <div className="min-h-screen flex items-center justify-center text-[var(--color-text-muted)]">Endringsmelding ikke funnet</div>

  const isReviewed = co.status !== 'pending'
  const sentToCustomer = co.status === 'pending' && !!co.sent_to_customer_at
  const margin = co.total_customer_value > 0
    ? Math.round((co.profit / co.total_customer_value) * 100)
    : 0

  // Status pill — ord og farger fra status-modulen (lib/statuses), inkl.
  // pending-nyansen Ubehandlet/Sendt kunde.
  const statusPill = changeOrderPill(co.status, sentToCustomer)

  // Versjonslogg events — every non-comment activity entry. Newest first.
  const versionEvents = activity
    .filter((a) => a.action !== 'commented')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <div className="min-h-screen bg-muted print:bg-white">
      <style jsx global>{`
        @media print {
          .print\\:hidden { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <header className="bg-white shadow print:hidden">
        <div className="px-4 sm:px-6 py-4 flex items-center gap-3 flex-wrap">
          <Link href="/admin/change-orders" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-sm">← Endringsmeldinger</Link>
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
              {fmtChangeOrderTitle(co.change_order_number, project?.name)}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">{sub?.company_name ?? '–'}</p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded ${statusPill.cls}`}>{statusPill.label}</span>
            {isReviewed && (
              <button
                onClick={() => handleStatus('pending')}
                disabled={submitting}
                className="px-3 py-1 text-xs bg-muted text-[var(--color-text-secondary)] rounded hover:bg-gray-200 disabled:opacity-50"
              >
                Angre
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* CENTER — Kundedel (printable) */}
        <section className="lg:col-span-9 space-y-6">
          <div className="bg-white rounded-lg shadow p-6 space-y-5">
            <div className="border-b border-border pb-3 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-xs text-[var(--color-text-muted)]">Endringsmelding {co.change_order_number}</p>
                  {(() => {
                    const t = changeOrderType(co.em_type)
                    return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${t.cls}`}>{t.label}</span>
                  })()}
                </div>
                <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{project?.name ?? '–'}</h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Prosjektnummer: {project?.project_number ?? '–'}
                  {co.submitted_at && ` · Innsendt ${co.submitted_at.split('T')[0]}`}
                </p>
              </div>
              {/* Action buttons live INSIDE the card so they're near the content
                  they affect. Hidden in print. */}
              <div className="flex items-center gap-2 print:hidden flex-none">
                {canSeeEconomy && !isReviewed && !editing && (
                  <button
                    onClick={startEdit}
                    disabled={submitting}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-white border border-border text-[var(--color-text-secondary)] rounded hover:bg-muted disabled:opacity-50"
                  >
                    <Pencil size={12} /> Rediger
                  </button>
                )}
                {canSeeEconomy && (
                  <button
                    onClick={exportPDF}
                    disabled={exporting || co.status === 'draft'}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50"
                    title="Markeres som 'Sendt kunde' og åpner print-dialog"
                  >
                    <Printer size={12} /> {exporting ? 'Markerer...' : 'Eksporter PDF'}
                  </button>
                )}
              </div>
            </div>

            {/* Lines table — kun kundevennlige kolonner (Produkt, Mengde,
                Total). Kost/Margin per linje er fjernet helt fra senterkortet
                siden dette går til kunde. Admin ser totalt kost + margin i
                Internt-kortet til høyre. Totalbeløpet sitter som tfoot-rad
                under produktene istedenfor som egen blå boks. */}
            <div>
              <p className="text-xs text-[var(--color-text-muted)] mb-2">Produkter</p>
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-xs text-[var(--color-text-muted)] uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Produkt</th>
                      <th className="px-3 py-2 text-right font-medium">Mengde</th>
                      {canSeeEconomy && <th className="px-3 py-2 text-right font-medium">Total</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(lines.length > 0
                      ? lines
                      : [{
                          id: co.id,
                          product_id: co.product_id,
                          requested_quantity: co.requested_quantity,
                          unit: co.unit,
                          cost_price_snapshot: co.cost_price_snapshot,
                          customer_price_snapshot: co.customer_price_snapshot,
                        } as unknown as ChangeOrderLine]
                    ).map((ln) => {
                      const p = products.find((pp) => pp.id === ln.product_id) ?? null
                      const lineSales = ln.requested_quantity * (ln.customer_price_snapshot ?? 0)
                      return (
                        <tr key={ln.id}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-[var(--color-text-primary)]">{fmtProductLabel(p)}</p>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-secondary)]">
                            {ln.requested_quantity} <span className="text-[var(--color-text-muted)]">{ln.unit}</span>
                          </td>
                          {canSeeEconomy && (
                            <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-secondary)]">
                              {fmt(lineSales)}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                  {canSeeEconomy && (
                    <tfoot className="bg-blue-50 border-t-2 border-blue-200">
                      <tr>
                        <td colSpan={2} className="px-3 py-2.5 text-sm font-medium text-blue-900">
                          Totalbeløp (eks. mva)
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-lg font-bold text-blue-900">
                          {fmt(co.total_customer_value)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            <div>
              <p className="text-xs text-[var(--color-text-muted)] mb-1">Beskrivelse</p>
              <p className="text-sm text-[var(--color-text-secondary)] bg-muted rounded p-3 whitespace-pre-line">{co.reason || '–'}</p>
            </div>

            <div>
              <p className="text-xs text-[var(--color-text-muted)] mb-1">Løsning</p>
              <p className="text-sm text-[var(--color-text-secondary)] bg-muted rounded p-3 whitespace-pre-line">{co.solution || '–'}</p>
            </div>

            {/* Konsekvens ved avslag — PL/admin-definert. Vises også på PDF
                så kunden ser hva som henger på en avvisning. Hvis ingen
                konsekvens er lagt inn skjules hele blokken (ikke vis "ingen
                konsekvens" — det er forvirrende). */}
            {consequenceLines.length > 0 && (
              <div>
                <p className="text-xs text-[var(--color-text-muted)] mb-1">Konsekvens ved å avslå</p>
                <div className="overflow-x-auto rounded border border-orange-200 bg-orange-50/50">
                  <table className="w-full text-sm">
                    <thead className="bg-orange-100/50 text-xs text-orange-900 uppercase tracking-wide">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Produkt</th>
                        <th className="px-3 py-2 text-right font-medium">Mengde</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-orange-100">
                      {consequenceLines.map((ln) => {
                        const p = products.find((pp) => pp.id === ln.product_id) ?? null
                        return (
                          <tr key={ln.id}>
                            <td className="px-3 py-2">
                              <p className="font-medium text-[var(--color-text-primary)]">{fmtProductLabel(p)}</p>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-secondary)]">
                              − {ln.quantity} <span className="text-[var(--color-text-muted)]">{ln.unit}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                  Hvis EM avvises, trekkes disse mengdene automatisk fra prosjektbudsjettet.
                </p>
              </div>
            )}

            {/* Inline edit panel — admin only, hidden in print. The product +
                quantity sit in a 'gammel → ny' table so the change is
                explicit at a glance. */}
            {editing && (
              <div className="print:hidden border-2 border-primary bg-primary-soft rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-primary">Rediger endringsmelding</p>
                  <button
                    type="button"
                    onClick={addEditLine}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-white border border-primary text-primary rounded hover:bg-primary-soft"
                  >
                    <Plus size={12} /> Legg til produkt
                  </button>
                </div>

                {/* Multi-row product table — admin can add, remove and edit
                    each line. Pris-snapshots resolves server-side from
                    each product's customer_price + the UE's price list. */}
                <div className="overflow-x-auto bg-white rounded border border-primary/30">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-[var(--color-text-secondary)]">Produkt</th>
                        <th className="px-3 py-2 text-right font-semibold text-[var(--color-text-secondary)] w-32">Mengde</th>
                        <th className="px-3 py-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editLines.map((ln) => {
                        const prod = products.find((p) => p.id === ln.product_id) ?? null
                        return (
                          <tr key={ln.tempId} className="border-t border-border">
                            <td className="px-3 py-2">
                              <select
                                value={ln.product_id}
                                onChange={(e) => updateEditLine(ln.tempId, { product_id: e.target.value })}
                                className="w-full px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                              >
                                <option value="">Velg produkt...</option>
                                {products.map((p) => (
                                  <option key={p.id} value={p.id}>{fmtProductLabel(p)}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.01"
                                  min="0"
                                  value={ln.requested_quantity}
                                  onChange={(e) => updateEditLine(ln.tempId, { requested_quantity: e.target.value })}
                                  className="w-20 px-2 py-1 text-right text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
                                />
                                <span className="text-[var(--color-text-muted)] text-xs w-8">{prod?.unit ?? ''}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => removeEditLine(ln.tempId)}
                                disabled={editLines.length <= 1}
                                className="p-1 text-[var(--color-text-muted)] hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                title={editLines.length <= 1 ? 'Minst én linje må være igjen' : 'Fjern linje'}
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Type</label>
                  <select
                    value={editEmType}
                    onChange={(e) => setEditEmType(e.target.value as 'economic' | 'spec_deviation' | 'time')}
                    className="block w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                  >
                    <option value="economic">Økonomisk</option>
                    <option value="spec_deviation">Avvik kravspec</option>
                    <option value="time">Tid</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Beskrivelse</label>
                  <textarea
                    rows={3}
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    placeholder="Hva er endringen?"
                    className="block w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Løsning</label>
                  <textarea
                    rows={3}
                    value={editSolution}
                    onChange={(e) => setEditSolution(e.target.value)}
                    placeholder="Hvordan løses det / hva blir gjort?"
                    className="block w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Konsekvens-tabell — admin/PM legger inn produkt + mengde
                    som vil bli FJERNET fra prosjektbudsjettet hvis EM
                    avvises. Tom liste tillatt: ingen konsekvens definert. */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-[var(--color-text-secondary)]">Konsekvens ved å avslå</label>
                    <button
                      type="button"
                      onClick={addConsequenceLine}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-white border border-orange-300 text-orange-700 rounded hover:bg-orange-50"
                    >
                      <Plus size={12} /> Legg til konsekvens
                    </button>
                  </div>
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    Produkter + mengder som vil trekkes fra prosjektbudsjettet hvis EMen avvises (samme UE som EMen).
                  </p>
                  {editConsequenceLines.length > 0 && (
                    <div className="overflow-x-auto bg-white rounded border border-orange-200">
                      <table className="w-full text-xs">
                        <thead className="bg-orange-50/50">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-orange-900">Produkt</th>
                            <th className="px-3 py-2 text-right font-semibold text-orange-900 w-32">Mengde (−)</th>
                            <th className="px-3 py-2 w-12"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {editConsequenceLines.map((ln) => {
                            const prod = products.find((p) => p.id === ln.product_id) ?? null
                            return (
                              <tr key={ln.tempId} className="border-t border-orange-100">
                                <td className="px-3 py-2">
                                  <select
                                    value={ln.product_id}
                                    onChange={(e) => updateConsequenceLine(ln.tempId, { product_id: e.target.value })}
                                    className="w-full px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white"
                                  >
                                    <option value="">Velg produkt...</option>
                                    {products.map((p) => (
                                      <option key={p.id} value={p.id}>{fmtProductLabel(p)}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="inline-flex items-center justify-end gap-1.5">
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      step="0.01"
                                      min="0"
                                      value={ln.quantity}
                                      onChange={(e) => updateConsequenceLine(ln.tempId, { quantity: e.target.value })}
                                      className="w-20 px-2 py-1 text-right text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-orange-400 tabular-nums"
                                    />
                                    <span className="text-[var(--color-text-muted)] text-xs w-8">{prod?.unit ?? ''}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => removeConsequenceLine(ln.tempId)}
                                    className="p-1 text-[var(--color-text-muted)] hover:text-red-600"
                                    title="Fjern konsekvens-linje"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {editError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{editError}</p>
                )}
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  Priser hentes automatisk fra prislisten. Endringen logges i versjonsloggen, og UE ser samme oppdatering — uten kundepriser.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    disabled={editSaving}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-white border border-border text-[var(--color-text-secondary)] rounded hover:bg-muted disabled:opacity-50"
                  >
                    <X size={12} /> Avbryt
                  </button>
                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={editSaving}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50"
                  >
                    <Save size={12} /> {editSaving ? 'Lagrer...' : 'Lagre'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Attachment — rides along in the PDF. */}
          {co.attachment_url && (
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">Vedlegg</p>
              <a
                href={`/api/change-orders/${co.id}/attachment?redirect=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block"
              >
                <img
                  src={`/api/change-orders/${co.id}/attachment?redirect=1`}
                  alt="Vedlegg"
                  className="max-w-full rounded border border-border"
                />
              </a>
            </div>
          )}

          {/* Admin action — hidden in print. Vises BÅDE for pending og
              revision_requested så admin kan handle direkte fra hvilken som
              helst av disse to "uavklart"-tilstandene. Kontekst-uegnede
              knapper skjules per status: Be om ny versjon + Til behandling
              er kun pending-relevant. */}
          {canSeeEconomy && (co.status === 'pending' || co.status === 'revision_requested') && (
            <div className="print:hidden bg-white rounded-lg shadow p-6 space-y-4">
              <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Behandle endringsmelding</h2>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Kommentar (valgfritt)</label>
                <textarea
                  value={comment}
                  onChange={(e) => { setComment(e.target.value); if (revisionError) setRevisionError(null) }}
                  rows={3}
                  className="block w-full px-3 py-2 text-sm text-[var(--color-text-primary)] border border-border rounded focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Legg til en kommentar til underentreprenøren..."
                />
                {revisionError && (
                  <p className="mt-1.5 text-sm text-red-600">{revisionError}</p>
                )}
              </div>
              <div className="flex gap-3 justify-end flex-wrap">
                <button
                  onClick={() => handleStatus('rejected')}
                  disabled={submitting}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  Avvis
                </button>
                {/* Sekundær outline-stil: dette er unntaks-/bokføringshandlinger,
                    ikke beslutninger — kun Godkjenn/Avvis skal være fylte. */}
                {co.status === 'pending' && (
                  <button
                    onClick={requestRevision}
                    disabled={submitting}
                    className="px-4 py-2 text-sm bg-white border border-border text-[var(--color-text-secondary)] rounded hover:bg-muted disabled:opacity-50"
                    title="Returnerer EMen til UE for revisjon. Kommentaren over blir vist for UE så de vet hva som mangler."
                  >
                    Be om ny versjon
                  </button>
                )}
                {co.status === 'pending' && !sentToCustomer && (
                  <button
                    onClick={markAsSent}
                    disabled={submitting}
                    className="px-4 py-2 text-sm bg-white border border-border text-[var(--color-text-secondary)] rounded hover:bg-muted disabled:opacity-50"
                    title="Markerer EM som sendt til kunde — pillen flippes fra 'Ubehandlet' til 'Sendt kunde'. Bruk når EMen er sendt ut via annen kanal enn Eksporter PDF."
                  >
                    Marker som sendt kunde
                  </button>
                )}
                <button
                  onClick={() => handleStatus('approved')}
                  disabled={submitting}
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Godkjenn
                </button>
              </div>
            </div>
          )}

          {/* Returnert til UE for revisjon — egen panel siden statusen ikke er
              "ferdig behandlet"; admin venter på at UE skal sende inn ny
              versjon. Angre-knappen øverst i headeren kan trekke EMen tilbake
              til pending hvis admin ombestemmer seg. */}
          {co.status === 'revision_requested' && (
            <div className="print:hidden bg-orange-50 border border-orange-200 rounded-lg p-6 space-y-2">
              <p className="text-sm font-semibold text-orange-900">Returnert til UE for revisjon</p>
              <p className="text-xs text-orange-700">EMen ligger nå i UEs oppgaveboks. Når UE har rettet opp og sender inn på nytt, dukker den opp her som pending igjen.</p>
              {co.admin_comment && (
                <div>
                  <p className="text-xs text-orange-600 mb-1 mt-2">Kommentar til UE</p>
                  <p className="text-sm text-orange-900 bg-white rounded p-3 border border-orange-100 whitespace-pre-line">{co.admin_comment}</p>
                </div>
              )}
            </div>
          )}

          {/* Already reviewed (approved/rejected) — hidden in print */}
          {(co.status === 'approved' || co.status === 'rejected') && (
            <div className="print:hidden bg-white rounded-lg shadow p-6 space-y-2">
              <p className="text-sm font-medium text-[var(--color-text-secondary)]">Behandlet av: {co.reviewed_by ?? '–'}</p>
              <p className="text-sm text-[var(--color-text-muted)]">Dato: {co.reviewed_at?.split('T')[0] ?? '–'}</p>
              {co.admin_comment && (
                <div>
                  <p className="text-xs text-[var(--color-text-muted)] mb-1">Kommentar</p>
                  <p className="text-sm text-[var(--color-text-secondary)] bg-muted rounded p-3">{co.admin_comment}</p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* RIGHT — Avsender (top), Internt (mid), Versjonslogg (bottom).
            Alle tre print:hidden. Avsender-kortet er admin-rask-info som
            svarer "hvem sendte denne inn og når" uten å måtte scrolle ned
            til Versjonsloggen. */}
        <aside className="lg:col-span-3 print:hidden space-y-4">
          <div className="bg-white rounded-lg shadow p-5 space-y-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Avsender</h2>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--color-text-muted)] flex-none">Navn</dt>
                <dd className="font-medium text-[var(--color-text-primary)] truncate text-right">{co.submitted_by ?? '–'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--color-text-muted)] flex-none">Firma</dt>
                <dd className="font-medium text-[var(--color-text-primary)] truncate text-right">{sub?.company_name ?? '–'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--color-text-muted)] flex-none">Dato</dt>
                <dd className="font-medium text-[var(--color-text-primary)] tabular-nums text-right">
                  {co.submitted_at
                    ? new Date(co.submitted_at).toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo' })
                    : '–'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--color-text-muted)] flex-none">Klokkeslett</dt>
                <dd className="font-medium text-[var(--color-text-primary)] tabular-nums text-right">
                  {co.submitted_at
                    ? new Date(co.submitted_at).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
                    : '–'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="bg-white rounded-lg shadow p-5 space-y-3">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{canSeeEconomy ? 'Internt — økonomi' : 'Internt — kostnad'}</h2>
            <p className="text-[10px] text-[var(--color-text-muted)] -mt-2">Skjules i PDF og hos UE</p>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--color-text-muted)]">UE-kostpris</dt>
                <dd className="font-medium text-[var(--color-text-primary)] tabular-nums">{fmt(co.cost_price_snapshot)}/{co.unit}</dd>
              </div>
              {canSeeEconomy && (
                <div className="flex justify-between">
                  <dt className="text-[var(--color-text-muted)]">Kundepris</dt>
                  <dd className="font-medium text-[var(--color-text-primary)] tabular-nums">{fmt(co.customer_price_snapshot)}/{co.unit}</dd>
                </div>
              )}
              <div className="border-t border-border pt-2 flex justify-between">
                <dt className="text-[var(--color-text-muted)]">Total kostnad</dt>
                <dd className="font-semibold text-[var(--color-text-primary)] tabular-nums">{fmt(co.total_cost)}</dd>
              </div>
              {canSeeEconomy && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-[var(--color-text-muted)]">Salgsverdi</dt>
                    <dd className="font-semibold text-[var(--color-text-primary)] tabular-nums">{fmt(co.total_customer_value)}</dd>
                  </div>
                  <div className="border-t border-border pt-2 flex justify-between">
                    <dt className="text-[var(--color-text-muted)]">Fortjeneste</dt>
                    <dd className={`font-bold tabular-nums ${co.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(co.profit)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--color-text-muted)]">Margin</dt>
                    <dd className={`font-semibold tabular-nums ${margin >= 15 ? 'text-green-600' : 'text-orange-500'}`}>{margin}%</dd>
                  </div>
                </>
              )}
            </dl>
          </div>

          <div className="bg-white rounded-lg shadow p-5 space-y-3">
            <div className="flex items-center gap-2">
              <History size={14} className="text-[var(--color-text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Versjonslogg</h2>
            </div>
            {versionEvents.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">Ingen endringer ennå</p>
            ) : (
              <ol className="space-y-2">
                {versionEvents.map((ev) => {
                  const hasDiff = !!ev.metadata?.before || !!ev.metadata?.after
                  return (
                    <li key={ev.id}>
                      <button
                        type="button"
                        onClick={() => hasDiff && setDiffEntry(ev)}
                        disabled={!hasDiff}
                        className={`w-full text-left text-xs space-y-0.5 border-l-2 pl-2.5 py-1 rounded-r transition-colors ${
                          hasDiff
                            ? 'border-primary/40 hover:bg-primary-soft cursor-pointer'
                            : 'border-border cursor-default'
                        }`}
                        title={hasDiff ? 'Klikk for å se gammel vs ny' : undefined}
                      >
                        <p className="font-medium text-[var(--color-text-primary)] flex items-center justify-between gap-2">
                          <span>{activityActionLabel(ev.action)}</span>
                          {hasDiff && <span className="text-[10px] text-primary">Se diff →</span>}
                        </p>
                        {ev.comment && (
                          <p className="text-[var(--color-text-secondary)]">{ev.comment}</p>
                        )}
                        <p className="text-[var(--color-text-muted)]">
                          {ev.actor} · {new Date(ev.created_at).toLocaleString('nb-NO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </aside>
      </main>

      <VersionDiffModal
        entry={diffEntry}
        productNameLookup={(id) => {
          const p = products.find((pp) => pp.id === id)
          return p ? fmtProductLabel(p) : id
        }}
        onClose={() => setDiffEntry(null)}
      />
    </div>
  )
}
