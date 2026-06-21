'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { AlertTriangle, AlertCircle, Mail } from 'lucide-react'
import type { Project, ProjectBudgetLine, ChangeOrder, ProjectInternalCostEntry, ProjectInvoice, ProductionEntry, ProjectMaterial } from '@/types'
import { fmtNOK as fmt } from '@/lib/format'
import { computeProjectEconomy } from '@/lib/project-economy'
import { internalCostTotal as sumInternalCosts, fallbackEndMonthIndex, internalCostToDate, currentMonthIndex } from '@/lib/internal-costs'
import type { WRWithLines, ProjectManagerRow } from './useProjectData'

/**
 * Always-visible status hero at the top of a project page. To kolonner:
 *
 *   RESULTAT (per i dag) — hva som FAKTISK har skjedd:
 *     opptjent (godkjente rapportlinjer × kundepris)
 *     − UE-kost påløpt (godkjente rapportlinjer × UE-kostpris)
 *     − internkost påløpt (interne poster utvidet t.o.m. inneværende måned)
 *     = resultat hittil. Pluss fakturert som info-linje.
 *
 *   PROGNOSE (forventet ved ferdig) — hva det LANDER på, mot budsjett:
 *     ordreverdi (budsjett + godkjente EM)
 *     − UE-kost budsjett − internkost (hele fremdriftsplan-perioden)
 *     = forventet fortjeneste.
 *
 * Reads its data from useProjectData state — no extra fetch. En "krever
 * oppmerksomhet"-banner og kontaktpersoner-stripe vises under når relevant.
 * Click-through targets are passed as callbacks so the hero stays decoupled
 * from the page's tab state.
 */
interface Props {
  project: Project
  budgetLines: ProjectBudgetLine[]
  weeklyReportsWL: WRWithLines[]
  changeOrders: ChangeOrder[]
  internalCosts: ProjectInternalCostEntry[]
  /** Produksjonsføringer (migrasjon 0018) — knyttet til en budsjettlinje teller
   *  mengden opptjent STRAKS mot kunde (× kundepris-snapshot). Uten denne ble
   *  produksjon aldri synlig i økonomi-heroen. */
  productionEntries: ProductionEntry[]
  /** Fakturaer (delt kilde med fakturerings-kortet) — gir «Fakturert»-linja. */
  invoices: ProjectInvoice[]
  /** Periodens slutt for løpende interne kostnader — følger fremdriftsplanen. */
  periodEnd: string | null
  projectManagers: ProjectManagerRow[]
  /** Materiellbudsjett (migrasjon 0021) — totalverdien trekkes fra som kost i prognosen. */
  materials: ProjectMaterial[]
  onGoToTab: (tab: 'endringsmeldinger' | 'rapporteringer') => void
}

/** Én linje i lønnsomhets-oppstillingen: etikett venstre, beløp høyre. */
function ResultRow({
  label, value, sub, sign, strong, tone = 'default',
}: {
  label: string
  value: string
  sub?: string
  sign?: '−' | '='
  strong?: boolean
  tone?: 'default' | 'green' | 'red' | 'muted'
}) {
  const toneClass = tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-600' : tone === 'muted' ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-primary)]'
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`${strong ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'} text-sm`}>
        {sign && <span className="text-[var(--color-text-muted)] mr-1 tabular-nums">{sign}</span>}{label}
      </span>
      <span className="text-right">
        <span className={`tabular-nums ${strong ? 'text-lg font-bold' : 'text-sm'} ${toneClass}`}>{value}</span>
        {sub && <span className="block text-[10px] text-[var(--color-text-muted)] leading-tight">{sub}</span>}
      </span>
    </div>
  )
}

export default function ProjectStatusHero({
  project,
  budgetLines,
  weeklyReportsWL,
  changeOrders,
  internalCosts,
  productionEntries,
  invoices,
  periodEnd,
  projectManagers,
  materials,
  onGoToTab,
}: Props) {
  // All formler bor i økonomi-modulen (lib/project-economy.ts) — endres
  // de der, følger hero, API-ruter og alle andre visninger med.
  // Materiell i økonomien:
  //  - ordreverdi   = Σ planlagt × pris (HELE budsjettet)      → legges til ordreverdi
  //  - avstemt verdi = Σ planlagt × pris for AVSTEMTE linjer    → teller som opptjent
  //  - avstemt kost  = Σ faktisk × pris for AVSTEMTE linjer     → kosten påløper FØRST nå
  const { materialOrderValue, materialReconciledValue, materialReconciledCost } = useMemo(() => {
    let order = 0, recVal = 0, recCost = 0
    for (const m of materials) {
      const price = Number(m.unit_price) || 0
      const planned = Number(m.planned_quantity) || 0
      order += planned * price
      if (m.reconciled) {
        recVal += planned * price
        recCost += (Number(m.actual_quantity) || 0) * price
      }
    }
    return { materialOrderValue: order, materialReconciledValue: recVal, materialReconciledCost: recCost }
  }, [materials])
  const summary = useMemo(
    () => computeProjectEconomy({
      budgetLines,
      weeklyReports: weeklyReportsWL,
      changeOrders,
      // PROGNOSE: løpende interne kostnader regnes over HELE fremdriftsplanen
      // (periodEnd), ikke prosjektets statiske sluttdato.
      internalCostTotal: sumInternalCosts(internalCosts, fallbackEndMonthIndex(periodEnd, new Date())),
      // Produksjonsføringer øker opptjent straks (× budsjettlinjas kundepris).
      productionEntries,
      // Materiell: budsjettet legges til ordreverdi; avstemt materiell teller som
      // opptjent, og kosten påløper FØRST ved avstemming.
      materialOrderValue,
      materialReconciledValue,
      materialReconciledCost,
    }),
    [budgetLines, changeOrders, weeklyReportsWL, internalCosts, periodEnd, productionEntries, materialOrderValue, materialReconciledValue, materialReconciledCost],
  )

  // RESULTAT (per i dag): internkost PÅLØPT t.o.m. inneværende måned — det
  // faktiske forbruket hittil, ikke hele planen.
  const internCostToDateVal = useMemo(
    () => internalCostToDate(internalCosts, currentMonthIndex(new Date())),
    [internalCosts],
  )
  // Fakturert hittil (delt kilde med fakturerings-kortet).
  const invoiced = useMemo(() => invoices.reduce((s, i) => s + (i.amount ?? 0), 0), [invoices])
  // Resultat hittil = opptjent − påløpte kostnader. Opptjent og UE-kost påløpt
  // bygger på SAMME godkjente rapportlinjer, så marginen er sammenlignbar.
  const actualResult = summary.opptjent - summary.ueReportedCost - internCostToDateVal - summary.materialReconciledCost
  const invoicedPct = summary.totalContract > 0 ? Math.round((invoiced / summary.totalContract) * 100) : 0

  // Bar widths as % of totalContract (or zeroed if no contract yet)
  const total = summary.totalContract
  const wDelivered = total > 0 ? (summary.delivered / total) * 100 : 0
  const wPending = total > 0 ? (summary.pendingDelivery / total) * 100 : 0
  const wRemaining = total > 0 ? (summary.remaining / total) * 100 : 0

  const attentions: Array<{
    tone: 'amber' | 'red'
    label: string
    onClick?: () => void
  }> = []
  if (summary.pendingEMCount > 0) {
    attentions.push({
      tone: 'amber',
      label: `${summary.pendingEMCount} ${summary.pendingEMCount === 1 ? 'endringsmelding venter' : 'endringsmeldinger venter'} på behandling`,
      onClick: () => onGoToTab('endringsmeldinger'),
    })
  }
  if (summary.pendingReports > 0) {
    attentions.push({
      tone: 'amber',
      label: `${summary.pendingReports} ${summary.pendingReports === 1 ? 'ukesrapport venter' : 'ukesrapporter venter'} på godkjenning`,
      onClick: () => onGoToTab('rapporteringer'),
    })
  }
  if (summary.totalContract > 0 && summary.delivered / summary.totalContract > 0.9) {
    attentions.push({
      tone: 'red',
      label: `${Math.round((summary.delivered / summary.totalContract) * 100)}% av ordreverdien er levert — vurder å se på prognose og resterende budsjett`,
    })
  }

  // Header bits — dates formatted Norwegian, omit "–" parts that are missing.
  const fmtDate = (s: string | null | undefined) =>
    s ? new Date(s).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
  const dateRange = `${fmtDate(project.start_date)} – ${fmtDate(project.end_date)}`

  const marginPct = summary.totalContract > 0 ? Math.round((summary.expectedProfit / summary.totalContract) * 100) : 0

  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      {/* To kolonner: RESULTAT (faktisk hittil — opptjent minus påløpte
          kostnader, pluss fakturert som info) og PROGNOSE (forventet
          sluttresultat mot budsjett). Begge er et lite resultatregnskap som
          går opp i én sum. */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        {/* ── Resultat (per i dag) ──────────────────────────────────── */}
        <div className="p-4">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
              Resultat <span className="font-normal normal-case tracking-normal">· per i dag</span>
            </p>
            <p className="text-sm font-bold text-[var(--color-text-primary)]">
              {summary.progressPct}% opptjent
              {summary.overBudget && <span className="ml-1.5 text-red-600 text-xs">(overskredet)</span>}
            </p>
          </div>
          {/* Stablet fremdriftsbar: opptjent / til godkjenning / gjenstår */}
          <div className="flex w-full h-2 rounded-full overflow-hidden bg-muted mb-2.5">
            {wDelivered > 0 && <div className="h-full bg-green-500" style={{ width: `${wDelivered}%` }} title={`Opptjent: ${fmt(summary.delivered)}`} />}
            {wPending > 0 && <div className="h-full bg-amber-400" style={{ width: `${wPending}%` }} title={`Til godkjenning: ${fmt(summary.pendingDelivery)}`} />}
            {wRemaining > 0 && <div className="h-full bg-gray-200" style={{ width: `${wRemaining}%` }} title={`Gjenstår: ${fmt(summary.remaining)}`} />}
          </div>
          <div className="space-y-1">
            <ResultRow
              label="Opptjent"
              value={fmt(summary.opptjent)}
              sub={summary.pendingDelivery > 0 ? `+ ${fmt(summary.pendingDelivery)} til godkjenning` : 'produsert & godkjent'}
              tone="muted"
            />
            <ResultRow sign="−" label="UE-kost påløpt" value={fmt(summary.ueReportedCost)} tone="muted" />
            <ResultRow sign="−" label="Internkost påløpt" value={fmt(internCostToDateVal)} tone="muted" />
            <div className="border-t border-border pt-1.5 mt-0.5">
              <ResultRow
                sign="="
                label="Resultat hittil"
                value={fmt(actualResult)}
                strong
                tone={actualResult >= 0 ? 'green' : 'red'}
              />
            </div>
            {/* Fakturert — info, ikke del av resultatregnskapet */}
            <div className="flex items-baseline justify-between gap-3 border-t border-dashed border-border pt-1.5 mt-0.5">
              <span className="text-sm text-[var(--color-text-secondary)]">Fakturert</span>
              <span className="text-right">
                <span className="tabular-nums text-sm text-[var(--color-text-primary)]">{fmt(invoiced)}</span>
                {summary.totalContract > 0 && <span className="block text-[10px] text-[var(--color-text-muted)] leading-tight">{invoicedPct}% av ordreverdi</span>}
              </span>
            </div>
          </div>
        </div>

        {/* ── Prognose (forventet ved ferdig) ───────────────────────── */}
        <div className="p-4">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-2">
            Prognose <span className="font-normal normal-case tracking-normal">· forventet ved ferdig</span>
          </p>
          <div className="space-y-1">
            <ResultRow
              label="Ordreverdi"
              value={fmt(summary.totalContract)}
              sub={`original ${fmt(summary.originalBudget)} + EM ${fmt(summary.approvedEMValue)}${summary.materialOrderValue > 0 ? ` + materiell ${fmt(summary.materialOrderValue)}` : ''}`}
              tone="muted"
            />
            <ResultRow sign="−" label="UE-kost (budsjett)" value={fmt(summary.ueBudgetCost)} tone="muted" />
            <ResultRow sign="−" label="Internkost (hele perioden)" value={fmt(summary.internCost)} tone="muted" />
            {summary.materialReconciledCost > 0 && (
              <ResultRow sign="−" label="Materiellkost (avstemt)" value={fmt(summary.materialReconciledCost)} tone="muted" />
            )}
            <div className="border-t border-border pt-1.5 mt-0.5">
              <ResultRow
                sign="="
                label="Forventet fortjeneste"
                value={fmt(summary.expectedProfit)}
                sub={summary.totalContract > 0 ? `margin ${marginPct}%` : undefined}
                strong
                tone={summary.expectedProfit >= 0 ? 'green' : 'red'}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Attention banner */}
      {attentions.length > 0 && (
        <div className="border-t border-border bg-amber-50/50 px-4 py-2.5 space-y-1.5">
          <p className="text-xs font-semibold text-amber-800 inline-flex items-center gap-1.5">
            <AlertTriangle size={13} /> Krever oppmerksomhet
          </p>
          {attentions.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={a.onClick}
              disabled={!a.onClick}
              className={`block text-left w-full text-sm ${
                a.tone === 'red' ? 'text-red-700' : 'text-amber-800'
              } ${a.onClick ? 'hover:underline cursor-pointer' : 'cursor-default'}`}
            >
              {a.tone === 'red' ? <AlertCircle size={13} className="inline mr-1.5 -mt-0.5" /> : <span className="text-amber-500 mr-1.5">•</span>}
              {a.label}
              {a.onClick && <span className="text-[var(--color-text-muted)] ml-1">→</span>}
            </button>
          ))}
        </div>
      )}

      {/* Contact persons strip */}
      {projectManagers.length > 0 && (
        <div className="border-t border-border px-4 py-2.5 flex items-center gap-2 flex-wrap text-xs">
          <span className="text-[var(--color-text-muted)]">Kontaktpersoner:</span>
          {projectManagers.map((pm, i) => {
            if (!pm.user) return null
            return (
              <span key={pm.user_id} className="inline-flex items-center gap-1">
                <Link
                  href={`/admin/users/${pm.user_id}`}
                  className="font-medium text-[var(--color-text-primary)] hover:text-primary"
                >
                  {pm.user.full_name}
                </Link>
                <a
                  href={`mailto:${pm.user.email}`}
                  className="text-[var(--color-text-muted)] hover:text-primary"
                  title={pm.user.email}
                >
                  <Mail size={11} />
                </a>
                {i < projectManagers.length - 1 && <span className="text-[var(--color-text-muted)] mx-1">·</span>}
              </span>
            )
          })}
          <span className="ml-auto text-[var(--color-text-muted)]">{dateRange}</span>
        </div>
      )}
    </section>
  )
}
