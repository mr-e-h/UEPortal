'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { AlertTriangle, AlertCircle, Mail, TrendingUp, Target, Flag, BarChart3, Users, User, FileText, Package } from 'lucide-react'
import type { Project, ProjectBudgetLine, ChangeOrder, ProjectInternalCostEntry, ProjectInvoice, ProductionEntry, ProjectMaterial } from '@/types'
import { fmtNOK as fmt } from '@/lib/format'
import { computeProjectEconomy, materialOrderValue as calcMaterialOrderValue, materialReconciled } from '@/lib/project-economy'
import { internalCostTotal as sumInternalCosts, fallbackEndMonthIndex, internalCostToDate, currentMonthIndex } from '@/lib/internal-costs'
import type { WRWithLines, ProjectManagerRow } from './useProjectData'

/**
 * Always-visible status hero at the top of a project page. To dashboard-kort +
 * en fremdriftsstripe:
 *
 *   RESULTAT HITTIL — hva som FAKTISK har skjedd:
 *     opptjent − UE-kost påløpt − internkost påløpt − avstemt materiellkost
 *     = resultat hittil. Pluss fakturert som info-linje.
 *
 *   PROGNOSE VED FERDIG — hva det LANDER på, mot budsjett:
 *     ordreverdi (budsjett + godkjente EM + materiell)
 *     − UE-kost budsjett − internkost (hele fremdriftsplan-perioden)
 *     = forventet fortjeneste (+ margin).
 *
 *   FREMDRIFT — opptjent % + fakturert % som horisontale barer.
 *
 * Reads its data from useProjectData state — no extra fetch. En «krever
 * oppmerksomhet»-banner og kontaktpersoner-stripe vises når relevant.
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

/** Nøkkeltall-rad: lite ikon + etikett venstre, beløp (+ valgfri undertekst) høyre. */
function KpiRow({
  icon: Icon, label, value, sub,
}: {
  icon: typeof TrendingUp
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center flex-none text-[var(--color-text-muted)]">
        <Icon size={14} />
      </div>
      <span className="flex-1 text-sm text-[var(--color-text-secondary)]">{label}</span>
      <span className="text-right">
        <span className="block text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">{value}</span>
        {sub && <span className="block text-[11px] text-[var(--color-text-muted)] leading-tight">{sub}</span>}
      </span>
    </div>
  )
}

/** Horisontal fremdriftsbar: etikett venstre, bar i midten, prosent + tekst høyre. */
function ProgressBar({ label, pct, tone }: { label: string; pct: number; tone: 'green' | 'blue' }) {
  const color = tone === 'green' ? 'bg-green-500' : 'bg-blue-500'
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 flex-none text-sm text-[var(--color-text-secondary)]">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <span className="w-12 flex-none text-right text-sm font-bold text-[var(--color-text-primary)] tabular-nums">{pct}%</span>
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
  const { materialOrderValue, materialReconciledValue, materialReconciledCost } = useMemo(() => {
    // Begge delt med lib/project-economy — lik på lista/totaløkonomi OG på
    // Prognose-fanens budsjett-prognose-referanse.
    const { value, cost } = materialReconciled(materials)
    return { materialOrderValue: calcMaterialOrderValue(materials), materialReconciledValue: value, materialReconciledCost: cost }
  }, [materials])
  const summary = useMemo(
    () => computeProjectEconomy({
      budgetLines,
      weeklyReports: weeklyReportsWL,
      changeOrders,
      // PROGNOSE: løpende interne kostnader regnes over HELE fremdriftsplanen
      // (periodEnd), ikke prosjektets statiske sluttdato.
      internalCostTotal: sumInternalCosts(internalCosts, fallbackEndMonthIndex(periodEnd, new Date())),
      productionEntries,
      materialOrderValue,
      materialReconciledValue,
      materialReconciledCost,
    }),
    [budgetLines, changeOrders, weeklyReportsWL, internalCosts, periodEnd, productionEntries, materialOrderValue, materialReconciledValue, materialReconciledCost],
  )

  // RESULTAT (hittil): internkost PÅLØPT t.o.m. inneværende måned.
  const internCostToDateVal = useMemo(
    () => internalCostToDate(internalCosts, currentMonthIndex(new Date())),
    [internalCosts],
  )
  // Fakturert hittil (delt kilde med fakturerings-kortet).
  const invoiced = useMemo(() => invoices.reduce((s, i) => s + (i.amount ?? 0), 0), [invoices])
  // Resultat hittil = opptjent − påløpte kostnader.
  const actualResult = summary.opptjent - summary.ueReportedCost - internCostToDateVal - summary.materialReconciledCost
  const invoicedPct = summary.totalContract > 0 ? Math.round((invoiced / summary.totalContract) * 100) : 0
  const marginPct = summary.totalContract > 0 ? Math.round((summary.expectedProfit / summary.totalContract) * 100) : 0

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

  const fmtDate = (s: string | null | undefined) =>
    s ? new Date(s).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
  const dateRange = `${fmtDate(project.start_date)} – ${fmtDate(project.end_date)}`

  return (
    <div className="space-y-4">
      {/* Krever oppmerksomhet */}
      {attentions.length > 0 && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-2xl px-4 py-3 space-y-1.5">
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

      {/* To kort: Resultat hittil + Prognose ved ferdig */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Resultat hittil ── */}
        <div className="bg-card border border-border rounded-2xl shadow-sm p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-none">
              <TrendingUp size={18} className="text-green-600" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">Resultat hittil</h3>
          </div>
          <p className={`text-4xl font-bold tabular-nums mb-4 ${actualResult >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(actualResult)}</p>
          <div className="border-t border-border divide-y divide-border">
            <KpiRow icon={BarChart3} label="Opptjent" value={fmt(summary.opptjent)} sub={summary.pendingDelivery > 0 ? `+ ${fmt(summary.pendingDelivery)} til godkjenning` : undefined} />
            <KpiRow icon={Users} label="UE-kost påløpt" value={fmt(summary.ueReportedCost)} />
            <KpiRow icon={User} label="Internkost påløpt" value={fmt(internCostToDateVal)} />
            <KpiRow icon={FileText} label="Fakturert" value={fmt(invoiced)} sub={summary.totalContract > 0 ? `${invoicedPct}% av ordreverdi` : undefined} />
          </div>
        </div>

        {/* ── Prognose ved ferdig ── */}
        <div className="bg-card border border-border rounded-2xl shadow-sm p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-none">
              <Target size={18} className="text-green-600" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">Prognose ved ferdig</h3>
          </div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <p className={`text-4xl font-bold tabular-nums ${summary.expectedProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(summary.expectedProfit)}</p>
            {summary.totalContract > 0 && (
              <span className="text-sm font-semibold text-green-700 bg-green-50 px-2.5 py-1 rounded-full">margin {marginPct}%</span>
            )}
          </div>
          <div className="border-t border-border divide-y divide-border">
            <KpiRow
              icon={FileText}
              label="Ordreverdi"
              value={fmt(summary.totalContract)}
              sub={`original ${fmt(summary.originalBudget)} + EM ${fmt(summary.approvedEMValue)}${summary.materialOrderValue > 0 ? ` + materiell ${fmt(summary.materialOrderValue)}` : ''}`}
            />
            <KpiRow icon={Users} label="UE-kost (budsjett)" value={fmt(summary.ueBudgetCost)} />
            <KpiRow icon={User} label="Internkost (hele perioden)" value={fmt(summary.internCost)} />
            {summary.materialReconciledCost > 0 && (
              <KpiRow icon={Package} label="Materiellkost (avstemt)" value={fmt(summary.materialReconciledCost)} />
            )}
          </div>
        </div>
      </div>

      {/* ── Fremdrift (fullbredde) ── */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-none">
            <Flag size={18} className="text-blue-600" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">Fremdrift</h3>
        </div>
        <div className="space-y-3">
          <ProgressBar label="Opptjent" pct={summary.progressPct} tone="green" />
          <ProgressBar label="Fakturert" pct={invoicedPct} tone="blue" />
        </div>
      </div>

      {/* Kontaktpersoner */}
      {projectManagers.length > 0 && (
        <div className="bg-card border border-border rounded-2xl shadow-sm px-4 py-2.5 flex items-center gap-2 flex-wrap text-xs">
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
    </div>
  )
}
