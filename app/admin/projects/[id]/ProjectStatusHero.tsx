'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { AlertTriangle, AlertCircle, CheckCircle2, Mail } from 'lucide-react'
import type { Project, ProjectBudgetLine, ChangeOrder, ProjectInternalCostEntry } from '@/types'
import { fmtNOK as fmt } from '@/lib/format'
import { computeProjectEconomy } from '@/lib/project-economy'
import { internalCostTotal as sumInternalCosts, fallbackEndMonthIndex } from '@/lib/internal-costs'
import type { WRWithLines, ProjectManagerRow } from './useProjectData'

/**
 * Always-visible status hero at the top of a project page.
 *
 * Answers the four questions a project owner asks first:
 *   - Hva er totalen?  (TOTAL ORDREVERDI = budget + approved EM cost)
 *   - Hva er gjort?    (LEVERT = approved weekly-report lines + approved EMs)
 *   - Hva er igjen?    (GJENSTÅR = total - levert - til godkjenning)
 *   - Endringsmeldinger? (EM NETTO = sum approved EM cost, + counts)
 *
 * Reads its data from useProjectData state — no extra fetch — and renders
 * a compact stacked-progress bar + 4 KPI tiles + a "krever oppmerksomhet"
 * banner that only appears when there is something to action.
 *
 * Click-through targets are passed as callbacks so the hero stays decoupled
 * from the page's tab state.
 */
interface Props {
  project: Project
  budgetLines: ProjectBudgetLine[]
  weeklyReportsWL: WRWithLines[]
  changeOrders: ChangeOrder[]
  internalCosts: ProjectInternalCostEntry[]
  projectManagers: ProjectManagerRow[]
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

/** Én leveranse-linje: farget prikk + etikett + beløp (+ valgfri %). */
function DeliveryRow({ dot, label, value, pct }: { dot: string; label: string; value: string; pct?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="flex items-center gap-2 text-[var(--color-text-secondary)]">
        <span className={`w-2 h-2 rounded-full flex-none ${dot}`} />
        {label}
      </span>
      <span className="text-right tabular-nums text-[var(--color-text-primary)]">
        {value}{pct && <span className="text-[var(--color-text-muted)] ml-1.5 text-xs">{pct}</span>}
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
  projectManagers,
  onGoToTab,
}: Props) {
  // All formler bor i økonomi-modulen (lib/project-economy.ts) — endres
  // de der, følger hero, API-ruter og alle andre visninger med.
  const summary = useMemo(
    () => computeProjectEconomy({
      budgetLines,
      weeklyReports: weeklyReportsWL,
      changeOrders,
      // Engangs + løpende månedlige interne kostnader, utvidet over periodene.
      internalCostTotal: sumInternalCosts(internalCosts, fallbackEndMonthIndex(project.end_date, new Date())),
    }),
    [budgetLines, changeOrders, weeklyReportsWL, internalCosts, project.end_date],
  )

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
  const deliveredPct = summary.totalContract > 0 ? Math.round((summary.delivered / summary.totalContract) * 100) : 0

  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      {/* To grupperte blokker: LEVERANSE (hvor mye av kontrakten er levert) og
          LØNNSOMHET (et lite resultatregnskap der tallene står under hverandre
          og går opp i fortjeneste). Erstatter den brede 6-flis-raden. */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        {/* ── Leveranse ─────────────────────────────────────────────── */}
        <div className="p-5">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">Leveranse</p>
            <p className="text-sm font-bold text-[var(--color-text-primary)]">
              {summary.progressPct}% levert
              {summary.overBudget && <span className="ml-1.5 text-red-600 text-xs">(overskredet)</span>}
            </p>
          </div>
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Total ordreverdi</p>
          <p className="text-3xl font-bold text-[var(--color-text-primary)] tabular-nums leading-tight mt-0.5">{fmt(summary.totalContract)}</p>
          <p className="text-[11px] text-[var(--color-text-muted)] tabular-nums mt-1">
            Original {fmt(summary.originalBudget)} <span className="text-[var(--color-text-muted)]">+</span> EM {fmt(summary.approvedEMValue)}
          </p>
          {/* Stablet fremdriftsbar */}
          <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-muted mt-3 mb-3">
            {wDelivered > 0 && <div className="h-full bg-green-500" style={{ width: `${wDelivered}%` }} title={`Levert: ${fmt(summary.delivered)}`} />}
            {wPending > 0 && <div className="h-full bg-amber-400" style={{ width: `${wPending}%` }} title={`Til godkjenning: ${fmt(summary.pendingDelivery)}`} />}
            {wRemaining > 0 && <div className="h-full bg-gray-200" style={{ width: `${wRemaining}%` }} title={`Gjenstår: ${fmt(summary.remaining)}`} />}
          </div>
          <div className="space-y-1.5">
            <DeliveryRow dot="bg-green-500" label="Levert" value={fmt(summary.delivered)} pct={summary.totalContract > 0 ? `${deliveredPct}%` : undefined} />
            {summary.pendingDelivery > 0 && (
              <DeliveryRow dot="bg-amber-400" label="Til godkjenning" value={fmt(summary.pendingDelivery)} />
            )}
            <DeliveryRow dot="bg-gray-300" label="Gjenstår" value={fmt(summary.remaining)} />
          </div>
        </div>

        {/* ── Lønnsomhet (resultatregnskap) ─────────────────────────── */}
        <div className="p-5">
          <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">Lønnsomhet</p>
          <div className="space-y-2">
            <ResultRow label="Ordreverdi" value={fmt(summary.totalContract)} sub="inkl. godkjente EM" tone="muted" />
            <ResultRow sign="−" label="UE-kostnad" value={fmt(summary.ueBudgetCost)} sub={`rapportert ${fmt(summary.ueReportedCost)}`} tone="muted" />
            <ResultRow sign="−" label="Internkostnad" value={fmt(summary.internCost)} tone="muted" />
            <div className="border-t border-border pt-2">
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
        <div className="border-t border-border bg-amber-50/50 px-5 py-3 space-y-1.5">
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

      {/* Healthy state — only when there's actually data and no warnings */}
      {attentions.length === 0 && summary.totalContract > 0 && (
        <div className="border-t border-border px-5 py-3">
          <p className="text-xs text-green-700 inline-flex items-center gap-1.5">
            <CheckCircle2 size={13} /> Ingen oppgaver krever oppmerksomhet
          </p>
        </div>
      )}

      {/* Contact persons strip */}
      {projectManagers.length > 0 && (
        <div className="border-t border-border px-5 py-3 flex items-center gap-2 flex-wrap text-xs">
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
