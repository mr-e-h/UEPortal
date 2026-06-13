'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Send, Award, XCircle, CalendarClock } from 'lucide-react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import ConfirmDialog from '@/components/ConfirmDialog'
import { tenderStatus, tenderInvitationStatus } from '@/lib/statuses'
import StatusPill from '@/components/ui/StatusPill'
import { fmtNOK, fmtDateTime } from '@/lib/format'
import type {
  Tender, TenderLine, TenderInvitation, TenderBid, TenderBidLine,
} from '@/types'

type SubLite = { id: string; company_name: string }
type ProjectLite = { id: string; name: string; project_number: string } | null

function Chip({ status, kind }: { status: string; kind: 'tender' | 'invitation' }) {
  const meta = kind === 'tender' ? tenderStatus(status) : tenderInvitationStatus(status)
  return <StatusPill meta={meta} />
}

export default function TenderDetailClient({
  tender, project, lines, invitations, bids, bidLines, subcontractors,
}: {
  tender: Tender
  project: ProjectLite
  lines: TenderLine[]
  invitations: TenderInvitation[]
  bids: TenderBid[]
  bidLines: TenderBidLine[]
  subcontractors: SubLite[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmAward, setConfirmAward] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  // Forleng frist: inline datetime-velger. PATCH-ruten støtter deadline_at
  // allerede — dette er kun UI. Nyttig når UE-er trenger mer tid.
  const [extendOpen, setExtendOpen] = useState(false)
  const [newDeadline, setNewDeadline] = useState('')

  const subName = useMemo(
    () => new Map(subcontractors.map((s) => [s.id, s.company_name])),
    [subcontractors],
  )

  // Only UEs who have a current SUBMITTED bid appear as priced columns.
  const submittedBids = useMemo(
    () => bids.filter((b) => b.status === 'submitted').sort((a, b) => a.total_cost - b.total_cost),
    [bids],
  )
  // price lookup: bidId -> (lineId -> unit price)
  const priceMap = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const bl of bidLines) {
      if (!m.has(bl.tender_bid_id)) m.set(bl.tender_bid_id, new Map())
      m.get(bl.tender_bid_id)!.set(bl.tender_line_id, bl.unit_price)
    }
    return m
  }, [bidLines])

  const lowestTotal = submittedBids.length > 0 ? submittedBids[0].total_cost : null

  // Respondent overview: every invited UE + whether they answered.
  const bidBySub = useMemo(() => new Map(bids.map((b) => [b.subcontractor_id, b])), [bids])

  const isDraft = tender.status === 'draft'
  const isAwarded = tender.status === 'awarded'
  const isCancelled = tender.status === 'cancelled'
  const deadlinePassed = tender.deadline_at ? new Date(tender.deadline_at).getTime() < Date.now() : false

  async function call(url: string, body?: unknown, method = 'POST') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Handlingen feilet')
        setBusy(false)
        return false
      }
      router.refresh()
      setBusy(false)
      return true
    } catch {
      setError('Nettverksfeil')
      setBusy(false)
      return false
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/tenders" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-sm">← Anbud</Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
              {tender.title || <span className="italic text-[var(--color-text-muted)] font-medium">Uten tittel</span>}
            </h1>
            <Chip status={tender.status} kind="tender" />
          </div>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {project?.name ?? '–'}{project?.project_number ? ` · ${project.project_number}` : ''}
            {' · '}Svarfrist {fmtDateTime(tender.deadline_at)}
            {deadlinePassed && !isAwarded && <span className="text-orange-600 font-medium ml-1">(utløpt)</span>}
          </p>
          {tender.description && <p className="text-sm text-[var(--color-text-secondary)] mt-2">{tender.description}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          {isDraft && (
            <Button onClick={() => call(`/api/tenders/${tender.id}/send`)} disabled={busy} className="px-3 py-1.5 text-xs">
              <Send size={13} className="mr-1.5" /> Send ut
            </Button>
          )}
          {!isDraft && !isAwarded && !isCancelled && (
            <>
              <Button
                variant="secondary"
                onClick={() => setExtendOpen((v) => !v)}
                disabled={busy}
                className="px-3 py-1.5 text-xs"
              >
                <CalendarClock size={13} className="mr-1.5" /> Forleng frist
              </Button>
              {/* Ghost — destruktiv unntakshandling skal ikke konkurrere
                  visuelt med Forleng frist / Send ut. */}
              <Button
                variant="ghost"
                onClick={() => setConfirmCancel(true)}
                disabled={busy}
                className="px-3 py-1.5 text-xs"
              >
                <XCircle size={13} className="mr-1.5" /> Kanseller
              </Button>
            </>
          )}
        </div>
      </div>

      {extendOpen && !isDraft && !isAwarded && !isCancelled && (
        <div className="flex flex-wrap items-end gap-3 bg-card border border-border rounded-lg px-4 py-3">
          <label className="text-xs text-[var(--color-text-muted)] flex flex-col gap-1">
            Ny svarfrist
            <input
              type="datetime-local"
              value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card focus:outline-none focus:border-primary"
            />
          </label>
          <Button
            onClick={async () => {
              if (!newDeadline) return
              const ok = await call(`/api/tenders/${tender.id}`, { deadline_at: new Date(newDeadline).toISOString() }, 'PATCH')
              if (ok) { setExtendOpen(false); setNewDeadline('') }
            }}
            disabled={busy || !newDeadline}
            className="px-3 py-1.5 text-xs"
          >
            Lagre ny frist
          </Button>
          <p className="text-xs text-[var(--color-text-muted)]">
            UE-ene kan prise frem til ny frist. Innsendte tilbud beholdes.
          </p>
        </div>
      )}

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      {isAwarded && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          Tildelt <strong>{subName.get(tender.awarded_subcontractor_id ?? '') ?? 'UE'}</strong>
          {' · '}{fmtDateTime(tender.awarded_at)} · prisene er lagt inn i prosjektbudsjettet.
        </div>
      )}

      {/* Respondent overview */}
      <Card>
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Inviterte underentreprenører</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                <th className="px-4 py-2.5">Underentreprenør</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Totalpris</th>
                <th className="px-4 py-2.5">Sist oppdatert</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => {
                const bid = bidBySub.get(inv.subcontractor_id)
                const submitted = bid?.status === 'submitted'
                const isLowest = submitted && bid!.total_cost === lowestTotal
                return (
                  <tr key={inv.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">
                      {subName.get(inv.subcontractor_id) ?? 'Ukjent UE'}
                      {isLowest && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Lavest</span>}
                    </td>
                    <td className="px-4 py-2.5"><Chip status={inv.status} kind="invitation" /></td>
                    <td className="px-4 py-2.5 text-right font-medium text-[var(--color-text-primary)] whitespace-nowrap">
                      {submitted ? fmtNOK(bid!.total_cost) : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)] whitespace-nowrap">
                      {fmtDateTime(bid?.submitted_at ?? null)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {submitted && !isAwarded && !isCancelled && (
                        <button
                          onClick={() => setConfirmAward(inv.subcontractor_id)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <Award size={13} /> Velg
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {invitations.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">Ingen inviterte ennå</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Comparison matrix: product × UE */}
      {submittedBids.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Sammenligning per linje</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Enhetspris per produkt fra hvert innsendte tilbud</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                  <th className="px-4 py-2.5">Produkt</th>
                  <th className="px-4 py-2.5 text-right">Mengde</th>
                  {submittedBids.map((b) => (
                    <th key={b.id} className="px-4 py-2.5 text-right whitespace-nowrap">
                      {subName.get(b.subcontractor_id) ?? 'UE'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  // Find the lowest unit price across bids for this line (for highlight).
                  const prices = submittedBids.map((b) => priceMap.get(b.id)?.get(line.id) ?? null)
                  const valid = prices.filter((p): p is number => p != null)
                  const minPrice = valid.length > 0 ? Math.min(...valid) : null
                  return (
                    <tr key={line.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 text-[var(--color-text-primary)]">{line.description || '(uten navn)'}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)] whitespace-nowrap">
                        {line.quantity} {line.unit}
                      </td>
                      {submittedBids.map((b, i) => {
                        const price = prices[i]
                        const isMin = price != null && price === minPrice
                        return (
                          <td
                            key={b.id}
                            className={`px-4 py-2.5 text-right whitespace-nowrap ${isMin ? 'text-green-700 font-semibold' : 'text-[var(--color-text-secondary)]'}`}
                          >
                            {price != null ? fmtNOK(price) : '–'}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {/* Totals row */}
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-2.5 text-[var(--color-text-primary)]">Total</td>
                  <td className="px-4 py-2.5" />
                  {submittedBids.map((b) => {
                    const isLowest = b.total_cost === lowestTotal
                    const diff = lowestTotal != null ? b.total_cost - lowestTotal : 0
                    return (
                      <td key={b.id} className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className={isLowest ? 'text-green-700' : 'text-[var(--color-text-primary)]'}>
                          {fmtNOK(b.total_cost)}
                        </div>
                        {diff > 0 && <div className="text-[10px] font-normal text-[var(--color-text-muted)]">+{fmtNOK(diff)}</div>}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Lines preview when no bids yet */}
      {submittedBids.length === 0 && (
        <Card>
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Linjer ({lines.length})</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Ingen innsendte tilbud ennå</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                  <th className="px-4 py-2.5">Produkt / arbeid</th>
                  <th className="px-4 py-2.5 text-right">Mengde</th>
                  <th className="px-4 py-2.5">Enhet</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 text-[var(--color-text-primary)]">{line.description || '(uten navn)'}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--color-text-muted)]">{line.quantity}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{line.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {confirmAward && (
        <ConfirmDialog
          title={`Tildel anbud til ${subName.get(confirmAward) ?? 'UE'}?`}
          message="Tilbudet legges inn i prosjektets budsjett som kostgrunnlag, og de andre tilbudene markeres som ikke valgt. Fritekstlinjer må legges inn manuelt."
          confirmLabel="Tildel"
          onConfirm={async () => {
            const ok = await call(`/api/tenders/${tender.id}/award`, { subcontractor_id: confirmAward })
            setConfirmAward(null)
            if (ok) router.refresh()
          }}
          onCancel={() => setConfirmAward(null)}
        />
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Kanseller anbudet?"
          message="Underentreprenørene kan ikke lenger sende eller endre tilbud. Dette kan ikke angres."
          confirmLabel="Kanseller anbud"
          onConfirm={async () => {
            await call(`/api/tenders/${tender.id}`, { status: 'cancelled' }, 'PATCH')
            setConfirmCancel(false)
          }}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
    </div>
  )
}
