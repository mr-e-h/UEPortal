'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Trash2, Package, Type } from 'lucide-react'
import Card from '@/components/ui/Card'
import Field from '@/components/ui/Field'
import Button from '@/components/ui/Button'
import ErrorBox from '@/components/ui/ErrorBox'

type ProjectLite = { id: string; name: string; project_number: string }
type ProductLite = { id: string; name: string; description: string; unit: string }
type SubLite = { id: string; company_name: string }

type LineDraft = {
  tempId: string
  kind: 'product' | 'free'
  product_id: string
  description: string
  unit: string
  quantity: string
}

let counter = 0
const nextId = () => `l${counter++}`

function emptyLine(kind: 'product' | 'free'): LineDraft {
  return { tempId: nextId(), kind, product_id: '', description: '', unit: 'stk', quantity: '' }
}

export default function NewTenderForm({
  projects,
  products,
  subcontractors,
}: {
  projects: ProjectLite[]
  products: ProductLite[]
  subcontractors: SubLite[]
}) {
  const router = useRouter()
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [deadline, setDeadline] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine('product')])
  const [selectedSubs, setSelectedSubs] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const productById = new Map(products.map((p) => [p.id, p]))

  function updateLine(tempId: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l)))
  }
  function removeLine(tempId: string) {
    setLines((prev) => prev.filter((l) => l.tempId !== tempId))
  }
  function toggleSub(id: string) {
    setSelectedSubs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // When a product is picked, copy its unit so the line is self-describing.
  function onPickProduct(tempId: string, productId: string) {
    const p = productById.get(productId)
    updateLine(tempId, { product_id: productId, unit: p?.unit ?? 'stk' })
  }

  async function handleSubmit(submitNow: boolean) {
    setError(null)
    if (!projectId) { setError('Velg et prosjekt'); return }

    const payloadLines = lines
      .map((l) => ({
        product_id: l.kind === 'product' ? (l.product_id || null) : null,
        description: l.kind === 'product'
          ? (productById.get(l.product_id)?.description || productById.get(l.product_id)?.name || '')
          : l.description.trim(),
        unit: l.unit,
        quantity: Number(l.quantity) || 0,
      }))
      .filter((l) => l.quantity > 0 && (l.product_id || l.description))

    if (payloadLines.length === 0) {
      setError('Legg til minst én linje med mengde')
      return
    }
    if (submitNow && !deadline) {
      setError('Sett en svarfrist for å sende anbudet')
      return
    }
    if (submitNow && selectedSubs.size === 0) {
      setError('Velg minst én underentreprenør å invitere')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/tenders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          title,
          description,
          deadline_at: deadline ? new Date(deadline).toISOString() : null,
          lines: payloadLines,
          subcontractor_ids: Array.from(selectedSubs),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Kunne ikke opprette anbud')
        setSaving(false)
        return
      }
      const tenderId = (data as { id: string }).id

      // Optionally publish immediately.
      if (submitNow) {
        const sendRes = await fetch(`/api/tenders/${tenderId}/send`, { method: 'POST' })
        if (!sendRes.ok) {
          const sd = await sendRes.json().catch(() => ({}))
          // Tender was created as draft; tell the user and still navigate.
          setError((sd as { error?: string }).error ?? 'Anbud lagret som kladd, men kunne ikke sendes')
        }
      }
      router.push(`/admin/tenders/${tenderId}`)
    } catch {
      setError('Nettverksfeil — prøv igjen')
      setSaving(false)
    }
  }

  return (
    <main className="px-4 sm:px-6 py-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/tenders" className="text-gray-400 hover:text-gray-600 text-sm">← Anbud</Link>
        <h1 className="text-xl font-bold text-gray-900">Nytt anbud</h1>
      </div>

      <div className="space-y-6">
        {/* Project + meta */}
        <Card className="p-6 space-y-4">
          <Field label="Prosjekt">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-blue-500"
            >
              <option value="">Velg prosjekt…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.project_number ? ` (${p.project_number})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tittel (valgfritt)">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="F.eks. «Graving og fiber – Sentrum øst»"
              className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="Beskrivelse (valgfritt)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-blue-500"
            />
          </Field>
          <Field label="Svarfrist">
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-blue-500"
            />
          </Field>
        </Card>

        {/* Lines */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Produkter / arbeidsoperasjoner</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLines((p) => [...p, emptyLine('product')])}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100"
              >
                <Package size={13} /> Produkt
              </button>
              <button
                type="button"
                onClick={() => setLines((p) => [...p, emptyLine('free')])}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                <Type size={13} /> Fritekst
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.tempId} className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
                  {line.kind === 'product' ? (
                    <select
                      value={line.product_id}
                      onChange={(e) => onPickProduct(line.tempId, e.target.value)}
                      className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Velg produkt…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.description ? `${p.description} – ${p.name}` : p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) => updateLine(line.tempId, { description: e.target.value })}
                      placeholder="Arbeidsoperasjon"
                      className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                    />
                  )}
                </div>
                <div className="w-24">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.tempId, { quantity: e.target.value })}
                    placeholder="Mengde"
                    className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="w-20">
                  <input
                    type="text"
                    value={line.unit}
                    onChange={(e) => updateLine(line.tempId, { unit: e.target.value })}
                    placeholder="enhet"
                    className="block w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(line.tempId)}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                  title="Fjern linje"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {lines.length === 0 && (
              <p className="text-sm text-gray-400 py-2">Ingen linjer ennå — legg til produkt eller fritekst.</p>
            )}
          </div>
        </Card>

        {/* Invite UEs */}
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Inviter underentreprenører</h2>
          <p className="text-xs text-gray-500 mb-3">{selectedSubs.size} valgt</p>
          {subcontractors.length === 0 ? (
            <p className="text-sm text-gray-400">Ingen aktive underentreprenører.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {subcontractors.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSubs.has(s.id)}
                    onChange={() => toggleSub(s.id)}
                    className="rounded"
                  />
                  <span className="text-gray-800">{s.company_name}</span>
                </label>
              ))}
            </div>
          )}
        </Card>

        {error && <ErrorBox>{error}</ErrorBox>}

        <div className="flex gap-3">
          <Button type="button" onClick={() => handleSubmit(true)} disabled={saving}>
            {saving ? 'Lagrer…' : 'Opprett og send'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => handleSubmit(false)} disabled={saving}>
            Lagre som kladd
          </Button>
          <Button type="button" variant="ghost" href="/admin/tenders">Avbryt</Button>
        </div>
      </div>
    </main>
  )
}
