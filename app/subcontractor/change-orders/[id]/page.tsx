'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ChevronLeft, History, Pencil } from 'lucide-react'
import type { ChangeOrder, ChangeOrderLine, ChangeOrderConsequenceLine, ActivityEntry } from '@/types'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import StatusPill from '@/components/ui/StatusPill'
import { fmtNOK as fmt, fmtChangeOrderTitle, fmtDateTime } from '@/lib/format'
import { changeOrderType, changeOrderPill } from '@/lib/statuses'
import { activityActionLabel } from '@/lib/activity-actions'
import { useMe } from '@/lib/useMe'

// Lazy-load tunge interaktive komponenter — vises først etter et klikk.
const VersionDiffModal = dynamic(() => import('@/components/admin/VersionDiffModal'), { ssr: false })
const ChangeOrderModal = dynamic(() => import('@/components/subcontractor/ChangeOrderModal'), { ssr: false })

/**
 * UE EM-detaljside (lese-modus, punkt 1.6).
 *
 * Speiler admin-detaljen (app/admin/change-orders/[id]/page.tsx) MINUS all
 * kundeøkonomi: ingen kundepris, salgsverdi, fortjeneste eller margin. Bare
 * UE-ens egne kosttall (cost_price_snapshot / total_cost) vises. Datakilden
 * (GET /api/change-orders/[id]) strip-er kundepris-feltene server-side for
 * sub før det når klienten — denne siden viser dem aldri uansett.
 *
 * Åpnes for ALLE statuser (draft/pending/revision_requested/approved/rejected).
 * Redigering ligger bak en eksplisitt «Rediger/Revider»-knapp som kun vises
 * for draft + revision_requested (åpner ChangeOrderModal — samme modal som
 * samlesiden og prosjektsiden bruker).
 */

// UE-trygg EM: kundepris-feltene er strippet server-side.
type UEChangeOrder = Omit<ChangeOrder, 'customer_price_snapshot' | 'total_customer_value' | 'profit'>
type UELine = Omit<ChangeOrderLine, 'customer_price_snapshot'>
type UEConsequenceLine = Omit<ChangeOrderConsequenceLine, 'customer_price_snapshot'>

// Den UE-eide kladd-formen ChangeOrderModal forventer (med has_*-flagg).
type ModalDraft = UEChangeOrder & {
  has_admin_edits?: boolean
  has_consequence_lines?: boolean
}

type BudgetLine = {
  id: string
  product_id: string
  product_name: string
  unit: string
  budget_quantity: number
  subcontractor_cost_price_snapshot: number
}

type ProjectWithLines = {
  id: string
  name: string
  project_number: string
  budget_lines: BudgetLine[]
}

export default function SubcontractorChangeOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { me } = useMe()

  const [co, setCo] = useState<UEChangeOrder | null>(null)
  const [lines, setLines] = useState<UELine[]>([])
  const [consequenceLines, setConsequenceLines] = useState<UEConsequenceLine[]>([])
  const [project, setProject] = useState<ProjectWithLines | null>(null)
  const [projects, setProjects] = useState<ProjectWithLines[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [hasAdminEdits, setHasAdminEdits] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Versjonsdiff-popup (kundepris allerede strippet rekursivt av /api/activity).
  const [diffEntry, setDiffEntry] = useState<ActivityEntry | null>(null)
  // Redigerings-/revisjonsmodal — kun for draft + revision_requested.
  const [showEditModal, setShowEditModal] = useState(false)

  const load = useCallback(async () => {
    if (!me?.subcontractor_id) return
    // YTELSE/NOTAT: vi henter HELE prosjekt-payloaden bare for å slå opp
    // produktnavn (fra budsjettlinjene) + ett prosjekts metadata. GET
    // /api/subcontractor/projects støtter IKKE per-prosjekt-filtrering — den
    // ignorerer alle URL-params (inkl. subcontractor_id under) og utleder
    // sub-en fra sesjonen, så et project_id-kall finnes ikke å bytte til uten
    // å endre den ruten (utenfor denne filens eierskap). Lar kallet stå for å
    // bevare produktnavn-oppslaget; et fremtidig per-prosjekt-endepunkt kan
    // erstatte projRes uten å røre resten.
    const [emRes, projRes, actRes] = await Promise.all([
      fetch(`/api/change-orders/${id}`),
      fetch(`/api/subcontractor/projects?subcontractor_id=${me.subcontractor_id}`),
      fetch(`/api/activity?entity_id=${id}&entity_type=change_order`),
    ])
    if (!emRes.ok) {
      setNotFound(true)
      setLoading(false)
      return
    }
    const emData = (await emRes.json()) as {
      change_order: UEChangeOrder
      lines: UELine[]
      consequence_lines: UEConsequenceLine[]
    }
    const projData = (projRes.ok ? await projRes.json() : []) as ProjectWithLines[]
    const actData = (actRes.ok ? await actRes.json() : []) as ActivityEntry[]

    setCo(emData.change_order)
    setLines(Array.isArray(emData.lines) ? emData.lines : [])
    setConsequenceLines(Array.isArray(emData.consequence_lines) ? emData.consequence_lines : [])
    setProjects(Array.isArray(projData) ? projData : [])
    setProject(
      Array.isArray(projData)
        ? projData.find((p) => p.id === emData.change_order.project_id) ?? null
        : null,
    )
    const acts = Array.isArray(actData) ? actData : []
    setActivity(acts)
    // 'edited'-rader skrives kun av admin/PL — markerer at EMen er justert.
    setHasAdminEdits(acts.some((a) => a.action === 'edited'))
    setLoading(false)
  }, [id, me?.subcontractor_id])

  useEffect(() => {
    if (!me) return
    if (me.role !== 'sub') { setLoading(false); return }
    if (!me.subcontractor_id) { setLoading(false); return }
    load()
  }, [me, load])

  // Snarvei fra samlesiden: ?edit=1 åpner redigerings-/revisjonsmodalen rett
  // når EMen er lastet — men kun hvis den faktisk kan redigeres. Vi fjerner
  // edit-paramet etterpå så et nytt load() (etter lagring) ikke gjenåpner den.
  useEffect(() => {
    if (loading || !co) return
    if (searchParams.get('edit') !== '1') return
    if (co.status === 'draft' || co.status === 'revision_requested') {
      setShowEditModal(true)
    }
    router.replace(`/subcontractor/change-orders/${id}`)
  }, [loading, co, searchParams, router, id])

  // Produktnavn-oppslag fra prosjektets budsjettlinjer (samme kilde som
  // listene/modalen). Faller tilbake til product_id når en linje peker på et
  // produkt som ikke ligger i UE-ens budsjett (sjelden).
  const productNameMap = new Map(
    projects.flatMap((p) => p.budget_lines.map((bl) => [bl.product_id, bl.product_name] as const)),
  )
  const productName = (productId: string) => productNameMap.get(productId) ?? '–'

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Laster...</div>
  }
  if (notFound || !co) {
    return (
      <div className="p-6 space-y-4">
        <Link href="/subcontractor/change-orders" className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
          <ChevronLeft size={16} /> Endringsmeldinger
        </Link>
        <div className="flex items-center justify-center h-48 text-[var(--color-text-muted)]">
          Endringsmelding ikke funnet
        </div>
      </div>
    )
  }

  const sentToCustomer = co.status === 'pending' && !!co.sent_to_customer_at
  const statusPill = changeOrderPill(co.status, sentToCustomer)
  const typeMeta = changeOrderType(co.em_type)
  const isEditable = co.status === 'draft' || co.status === 'revision_requested'

  // Linjene som vises i tabellen: bruk change_order_lines hvis de finnes,
  // ellers fall tilbake til hovedradens enkeltprodukt (eldre EM-er).
  const displayLines: UELine[] = lines.length > 0
    ? lines
    : [{
        id: co.id,
        change_order_id: co.id,
        product_id: co.product_id,
        requested_quantity: co.requested_quantity,
        unit: co.unit,
        cost_price_snapshot: co.cost_price_snapshot,
        sort_order: 0,
        created_at: co.created_at,
      } as UELine]

  // Versjonslogg — alle ikke-kommentar-hendelser, nyeste først.
  const versionEvents = activity
    .filter((a) => a.action !== 'commented')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  // Kladd-objektet ChangeOrderModal trenger (med has_*-flagg utledet lokalt).
  const modalDraft: ModalDraft = {
    ...co,
    has_admin_edits: hasAdminEdits,
    has_consequence_lines: consequenceLines.length > 0,
  }
  const modalBudgetLines = (project?.budget_lines ?? []).map((bl) => ({
    product_id: bl.product_id,
    product_name: bl.product_name,
    unit: bl.unit,
    cost_price: bl.subcontractor_cost_price_snapshot,
  }))

  return (
    <div className="p-6 space-y-6">
      {/* Header — tilbakelenke, tittel, status-pill og evt. rediger-knapp */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Link
            href="/subcontractor/change-orders"
            className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          >
            <ChevronLeft size={16} /> Endringsmeldinger
          </Link>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
              {fmtChangeOrderTitle(co.change_order_number, project?.name)}
            </h1>
            <StatusPill meta={statusPill} />
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${typeMeta.cls}`}>
              {typeMeta.label}
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">
            Prosjektnummer: {project?.project_number ?? '–'}
          </p>
        </div>
        {isEditable && (
          <Button variant="primary" onClick={() => setShowEditModal(true)} className="inline-flex items-center gap-1.5">
            <Pencil size={14} />
            {co.status === 'revision_requested' ? 'Revider' : 'Rediger'}
          </Button>
        )}
      </div>

      {/* Admin har bedt om revisjon — vis kommentaren tydelig øverst */}
      {co.status === 'revision_requested' && (
        <Card className="border-orange-200 bg-orange-50">
          <div className="p-5 space-y-2">
            <p className="text-sm font-semibold text-orange-900">Prosjektleder har bedt om revisjon</p>
            {co.admin_comment ? (
              <p className="text-sm text-orange-900 whitespace-pre-line">{co.admin_comment}</p>
            ) : (
              <p className="text-sm text-orange-700">Rett opp endringsmeldingen og send den inn på nytt.</p>
            )}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Hovedinnhold */}
        <section className="lg:col-span-8 space-y-6">
          <Card className="overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Produkter</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-xs text-[var(--color-text-muted)] uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Produkt</th>
                    <th className="px-4 py-2.5 text-right font-medium">Mengde</th>
                    <th className="px-4 py-2.5 text-right font-medium">Din kostpris</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total kostnad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {displayLines.map((ln) => (
                    <tr key={ln.id}>
                      <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">
                        {productName(ln.product_id)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-secondary)]">
                        {ln.requested_quantity} <span className="text-[var(--color-text-muted)]">{ln.unit}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-secondary)]">
                        {fmt(ln.cost_price_snapshot)}/{ln.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-secondary)]">
                        {fmt(ln.cost_price_snapshot * ln.requested_quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted border-t-2 border-border">
                  <tr>
                    <td colSpan={3} className="px-4 py-2.5 text-sm font-medium text-[var(--color-text-primary)]">
                      Total kostnad (eks. mva)
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-base font-bold text-[var(--color-text-primary)]">
                      {fmt(co.total_cost)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card>
            <div className="p-6 space-y-5">
              <div>
                <p className="text-xs text-[var(--color-text-muted)] mb-1">Beskrivelse</p>
                <p className="text-sm text-[var(--color-text-secondary)] bg-muted rounded p-3 whitespace-pre-line">
                  {co.reason || '–'}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)] mb-1">Løsning</p>
                <p className="text-sm text-[var(--color-text-secondary)] bg-muted rounded p-3 whitespace-pre-line">
                  {co.solution || '–'}
                </p>
              </div>
            </div>
          </Card>

          {/* Konsekvens ved avslag — kun produkt + mengde (ingen kundepris).
              Skjules helt hvis ingen konsekvens er lagt inn. */}
          {consequenceLines.length > 0 && (
            <Card className="overflow-hidden border-orange-200">
              <div className="px-6 py-4 border-b border-orange-200 bg-orange-50">
                <h2 className="text-base font-semibold text-orange-900">Konsekvens ved å avslå</h2>
              </div>
              <div className="overflow-x-auto bg-orange-50/40">
                <table className="w-full text-sm">
                  <thead className="bg-orange-100/50 text-xs text-orange-900 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium">Produkt</th>
                      <th className="px-4 py-2.5 text-right font-medium">Mengde</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-orange-100">
                    {consequenceLines.map((cl) => (
                      <tr key={cl.id}>
                        <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">
                          {productName(cl.product_id)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-secondary)]">
                          − {cl.quantity} <span className="text-[var(--color-text-muted)]">{cl.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-6 py-3 text-xs text-[var(--color-text-muted)]">
                Hvis endringsmeldingen avvises, trekkes disse mengdene fra prosjektbudsjettet.
              </p>
            </Card>
          )}

          {/* Vedlegg */}
          {co.attachment_url && (
            <Card>
              <div className="p-6">
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
            </Card>
          )}

          {/* Behandlet (godkjent/avvist) — kommentar + dato. */}
          {(co.status === 'approved' || co.status === 'rejected') && (
            <Card>
              <div className="p-6 space-y-2">
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                  {co.status === 'approved' ? 'Godkjent' : 'Avvist'}
                  {co.reviewed_by ? ` av ${co.reviewed_by}` : ''}
                </p>
                <p className="text-sm text-[var(--color-text-muted)]">Dato: {co.reviewed_at?.split('T')[0] ?? '–'}</p>
                {co.admin_comment && (
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)] mb-1">Kommentar fra prosjektleder</p>
                    <p className="text-sm text-[var(--color-text-secondary)] bg-muted rounded p-3 whitespace-pre-line">
                      {co.admin_comment}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}
        </section>

        {/* Sidekolonne — metadata + versjonslogg */}
        <aside className="lg:col-span-4 space-y-4">
          <Card>
            <div className="p-5 space-y-2">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Detaljer</h2>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--color-text-muted)] flex-none">Status</dt>
                  <dd>
                    <StatusPill meta={statusPill} />
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--color-text-muted)] flex-none">Type</dt>
                  <dd className="text-[var(--color-text-primary)] text-right">{typeMeta.label}</dd>
                </div>
                {co.submitted_at && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--color-text-muted)] flex-none">Innsendt</dt>
                    <dd className="text-[var(--color-text-primary)] text-right tabular-nums">{fmtDateTime(co.submitted_at)}</dd>
                  </div>
                )}
                {co.submitted_by && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--color-text-muted)] flex-none">Innsendt av</dt>
                    <dd className="text-[var(--color-text-primary)] text-right truncate">{co.submitted_by}</dd>
                  </div>
                )}
                {sentToCustomer && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--color-text-muted)] flex-none">Sendt kunde</dt>
                    <dd className="text-[var(--color-text-primary)] text-right tabular-nums">{fmtDateTime(co.sent_to_customer_at)}</dd>
                  </div>
                )}
                {co.reviewed_at && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--color-text-muted)] flex-none">Behandlet</dt>
                    <dd className="text-[var(--color-text-primary)] text-right tabular-nums">{fmtDateTime(co.reviewed_at)}</dd>
                  </div>
                )}
              </dl>
            </div>
          </Card>

          {hasAdminEdits && (
            <Card className="border-purple-200">
              <div className="p-5 space-y-2">
                <p className="text-xs font-semibold text-purple-900 uppercase tracking-wide">Endret av prosjektleder</p>
                <p className="text-sm text-purple-900">
                  Denne endringsmeldingen er justert av prosjektleder. Se hva som er endret i versjonsloggen under.
                </p>
              </div>
            </Card>
          )}

          <Card>
            <div className="p-5 space-y-3">
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
                            {ev.actor} · {fmtDateTime(ev.created_at)}
                          </p>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          </Card>
        </aside>
      </div>

      {/* Versjonsdiff-popup — kundepris allerede strippet rekursivt av /api/activity. */}
      <VersionDiffModal
        entry={diffEntry}
        productNameLookup={(pid) => productNameMap.get(pid) ?? pid}
        onClose={() => setDiffEntry(null)}
      />

      {/* Rediger/Revider — kun for draft + revision_requested. Etter vellykket
          lagring lukkes modalen og detaljsiden lastes på nytt i lese-modus
          (viser ny status, f.eks. pending etter innsending). */}
      {showEditModal && isEditable && me?.subcontractor_id && (
        <ChangeOrderModal
          projectId={co.project_id}
          subcontractorId={me.subcontractor_id}
          budgetLines={modalBudgetLines}
          initialDraft={modalDraft}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false)
            router.refresh()
            load()
          }}
        />
      )}
    </div>
  )
}
