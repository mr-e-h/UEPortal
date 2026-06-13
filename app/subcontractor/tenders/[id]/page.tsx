'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useMe } from '@/lib/useMe'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import ErrorBox from '@/components/ui/ErrorBox'
import { fmtNOK, fmtDeadline } from '@/lib/format'
import type { TenderLine, TenderBid, TenderBidLine } from '@/types'

type TenderView = {
  id: string
  title: string
  description: string
  status: string
  deadline_at: string | null
  expired: boolean
}

type Payload = {
  tender: TenderView
  lines: TenderLine[]
  bid: TenderBid | null
  bidLines: TenderBidLine[]
}

export default function SubcontractorTenderDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const tenderId = params.id
  const { me } = useMe()

  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/subcontractor/tenders/${tenderId}`)
    if (!res.ok) {
      setError('Kunne ikke laste tilbudet')
      setLoading(false)
      return
    }
    const payload = await res.json() as Payload
    setData(payload)
    // Seed price inputs from any existing bid lines.
    const seeded: Record<string, string> = {}
    for (const bl of payload.bidLines) seeded[bl.tender_line_id] = String(bl.unit_price)
    setPrices(seeded)
    setComment(payload.bid?.comment ?? '')
    setLoading(false)
  }, [tenderId])

  useEffect(() => {
    if (!me) return
    if (me.role !== 'sub') { router.replace('/login'); return }
    load()
  }, [me, router, load])

  const locked = !!data && (data.tender.expired || !['sent', 'open'].includes(data.tender.status))

  // Running total = Σ unit price × quantity.
  const total = useMemo(() => {
    if (!data) return 0
    return data.lines.reduce((sum, line) => {
      const p = Number(prices[line.id])
      return sum + (Number.isFinite(p) && p > 0 ? p * line.quantity : 0)
    }, 0)
  }, [data, prices])

  async function save(submit: boolean) {
    if (!data) return
    setError(null)
    setNotice(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/subcontractor/tenders/${tenderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prices: Object.fromEntries(
            Object.entries(prices).map(([k, v]) => [k, Number(v) || 0]),
          ),
          comment,
          submit,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((body as { error?: string }).error ?? 'Lagring feilet')
        setSaving(false)
        return
      }
      setNotice(submit ? 'Tilbud sendt inn!' : 'Lagret som kladd')
      await load()
    } catch {
      setError('Nettverksfeil — prøv igjen')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Laster…</div>
  }
  if (!data) {
    return (
      <div className="p-6">
        <ErrorBox>{error ?? 'Fant ikke tilbudet'}</ErrorBox>
        <Link href="/subcontractor/tenders" className="text-sm text-primary hover:underline mt-3 inline-block">← Tilbud</Link>
      </div>
    )
  }

  const submitted = data.bid?.status === 'submitted'

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/subcontractor/tenders" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-sm">← Tilbud</Link>
      </div>

      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{data.tender.title || 'Tilbudsforespørsel'}</h1>
        <p className={`text-sm mt-1 ${data.tender.expired ? 'text-orange-600 font-medium' : 'text-[var(--color-text-muted)]'}`}>
          Svarfrist: {fmtDeadline(data.tender.deadline_at)}{data.tender.expired ? ' — utløpt' : ''}
        </p>
        {data.tender.description && (
          <p className="text-sm text-[var(--color-text-secondary)] mt-2">{data.tender.description}</p>
        )}
      </div>

      {locked && (
        <div className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded px-3 py-2">
          {data.tender.expired
            ? 'Svarfristen har gått ut. Du kan se tilbudet ditt, men ikke endre det.'
            : 'Dette anbudet er ikke lenger åpent for prising.'}
        </div>
      )}
      {submitted && !locked && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          Tilbudet ditt er sendt inn. Du kan justere prisene og sende inn på nytt frem til fristen.
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                <th className="px-4 py-2.5">Produkt / arbeid</th>
                <th className="px-4 py-2.5 text-right">Mengde</th>
                <th className="px-4 py-2.5 text-right">Enhetspris</th>
                <th className="px-4 py-2.5 text-right">Sum</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line) => {
                const p = Number(prices[line.id])
                const lineSum = Number.isFinite(p) && p > 0 ? p * line.quantity : 0
                return (
                  <tr key={line.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 text-[var(--color-text-primary)]">{line.description || '(uten navn)'}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)] whitespace-nowrap">
                      {line.quantity} {line.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        disabled={locked}
                        value={prices[line.id] ?? ''}
                        onChange={(e) => setPrices((prev) => ({ ...prev, [line.id]: e.target.value }))}
                        placeholder="0"
                        className="w-28 px-2 py-1 text-sm text-right border border-border rounded focus:outline-none focus:border-blue-500 disabled:bg-muted disabled:text-[var(--color-text-muted)]"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--color-text-primary)] whitespace-nowrap">
                      {fmtNOK(lineSum)}
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                <td className="px-4 py-2.5 text-[var(--color-text-primary)]" colSpan={3}>Totalsum</td>
                <td className="px-4 py-2.5 text-right text-[var(--color-text-primary)] whitespace-nowrap">{fmtNOK(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <label className="block text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide mb-1">
          Kommentar (valgfritt)
        </label>
        <textarea
          value={comment}
          disabled={locked}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          className="block w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:border-blue-500 disabled:bg-muted"
          placeholder="Forutsetninger, forbehold, leveringstid…"
        />
      </Card>

      {error && <ErrorBox>{error}</ErrorBox>}
      {notice && <ErrorBox variant="success">{notice}</ErrorBox>}

      {!locked && (
        <div className="flex gap-3">
          <Button onClick={() => save(true)} disabled={saving}>
            {saving ? 'Sender…' : submitted ? 'Send inn revidert tilbud' : 'Send inn tilbud'}
          </Button>
          <Button variant="secondary" onClick={() => save(false)} disabled={saving}>
            Lagre som kladd
          </Button>
        </div>
      )}
    </div>
  )
}
