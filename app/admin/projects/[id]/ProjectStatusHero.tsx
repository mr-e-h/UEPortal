'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { AlertTriangle, AlertCircle, CheckCircle2, Mail } from 'lucide-react'
import type { Project, ProjectBudgetLine, ChangeOrder, ProjectInternalCostEntry } from '@/types'
import { fmtNOK as fmt } from '@/lib/format'
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

interface KpiTileProps {
  label: string
  value: string
  context?: string
  tone?: 'default' | 'green' | 'amber' | 'red'
}

function KpiTile({ label, value, context, tone = 'default' }: KpiTileProps) {
  const valueClass = tone === 'green'
    ? 'text-green-700'
    : tone === 'amber'
    ? 'text-amber-700'
    : tone === 'red'
    ? 'text-red-700'
    : 'text-[var(--color-text-primary)]'
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">{label}</p>
      <p className={`text-xl font-bold mt-1 leading-tight ${valueClass}`}>{value}</p>
      {context && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{context}</p>}
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
  const summary = useMemo(() => {
    // Original order book (sales value to customer — that's the contract).
    const originalBudget = budgetLines.reduce(
      (s, bl) => s + (bl.budget_quantity ?? 0) * (bl.customer_price_snapshot ?? 0),
      0,
    )

    // Approved EMs add to the contract value; pending EMs are NOT yet binding
    // but matter for the "needs attention" banner and EM-netto context.
    const approvedEMs = changeOrders.filter((co) => co.status === 'approved')
    const pendingEMs = changeOrders.filter((co) => co.status === 'pending')
    const approvedEMValue = approvedEMs.reduce((s, co) => s + (co.total_customer_value ?? 0), 0)
    const pendingEMValue = pendingEMs.reduce((s, co) => s + (co.total_customer_value ?? 0), 0)

    const totalContract = originalBudget + approvedEMValue

    // Delivered = approved weekly report lines × their customer price snapshot
    // (so the progress bar shows revenue value, matching ordreverdi units).
    const blPriceMap = new Map(budgetLines.map((bl) => [bl.id, bl.customer_price_snapshot ?? 0]))
    let deliveredValue = 0
    let pendingDeliveryValue = 0
    for (const report of weeklyReportsWL) {
      for (const line of report.lines) {
        const price = blPriceMap.get(line.project_budget_line_id) ?? 0
        const lineValue = line.reported_quantity * price
        // A line counts as "delivered" only when the line itself is approved
        // (approve-all puts every line on approved; reject-all sets rejected).
        if (line.status === 'approved') {
          deliveredValue += lineValue
        } else if (report.status === 'submitted' || line.status === 'pending') {
          pendingDeliveryValue += lineValue
        }
      }
    }

    // Pending reports counted at report level (not line level) — banner needs
    // a number a human can scan, not "47 lines waiting".
    const pendingReports = weeklyReportsWL.filter((r) => r.status === 'submitted').length

    // UE-kost + forventet fortjeneste — samme formler som Kostnadsflyt brukte
    // (kortene bodde der før; nå er ALL prosjektøkonomi samlet i heroen).
    const ueLines = budgetLines.filter(
      (bl) => bl.assigned_subcontractor_id && bl.assigned_subcontractor_id !== '__intern__',
    )
    const ueBudgetCost = ueLines.reduce(
      (s, bl) => s + (bl.budget_quantity ?? 0) * (bl.subcontractor_cost_price_snapshot ?? 0),
      0,
    )
    const ueLineIds = new Set(ueLines.map((bl) => bl.id))
    const blCostMap = new Map(budgetLines.map((bl) => [bl.id, bl.subcontractor_cost_price_snapshot ?? 0]))
    let ueReportedCost = 0
    for (const report of weeklyReportsWL) {
      if (report.status !== 'approved' && report.status !== 'partially_approved') continue
      for (const line of report.lines) {
        if (line.status === 'approved' && ueLineIds.has(line.project_budget_line_id)) {
          ueReportedCost += line.reported_quantity * (blCostMap.get(line.project_budget_line_id) ?? 0)
        }
      }
    }
    const internCost = internalCosts.reduce((s, c) => s + c.amount, 0)
    const expectedProfit = totalContract - ueBudgetCost - internCost

    // Bar segments (clamped to a sane stacking)
    const delivered = Math.min(deliveredValue, totalContract)
    const pendingDelivery = Math.min(pendingDeliveryValue, Math.max(0, totalContract - delivered))
    const remaining = Math.max(0, totalContract - delivered - pendingDelivery)

    const progressPct = totalContract > 0 ? Math.round((delivered / totalContract) * 100) : 0
    const overBudget = delivered > totalContract

    return {
      originalBudget,
      totalContract,
      approvedEMValue,
      pendingEMValue,
      approvedEMCount: approvedEMs.length,
      pendingEMCount: pendingEMs.length,
      delivered,
      pendingDelivery,
      remaining,
      progressPct,
      overBudget,
      pendingReports,
      ueBudgetCost,
      ueReportedCost,
      internCost,
      expectedProfit,
    }
  }, [budgetLines, changeOrders, weeklyReportsWL, internalCosts])

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

  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Progress bar */}
      <div className="px-5 pt-5">
        <div className="flex items-end justify-between gap-4 mb-2">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">Status</p>
          <p className="text-sm font-bold text-[var(--color-text-primary)]">
            {summary.progressPct}% levert
            {summary.overBudget && <span className="ml-2 text-red-600 text-xs">(overskredet)</span>}
          </p>
        </div>
        {/* Tallene bor i KPI-kortene under — baren trenger ingen egen legend.
            Segment-tooltips beholder detaljene ved hover (inkl. «til
            godkjenning», som ikke har eget kort). */}
        <div className="flex w-full h-3 rounded-full overflow-hidden bg-muted">
          {wDelivered > 0 && <div className="h-full bg-green-500" style={{ width: `${wDelivered}%` }} title={`Levert: ${fmt(summary.delivered)}`} />}
          {wPending > 0 && <div className="h-full bg-amber-400" style={{ width: `${wPending}%` }} title={`Til godkjenning: ${fmt(summary.pendingDelivery)}`} />}
          {wRemaining > 0 && <div className="h-full bg-gray-200" style={{ width: `${wRemaining}%` }} title={`Gjenstår: ${fmt(summary.remaining)}`} />}
        </div>
      </div>

      {/* KPI tiles — ALL prosjektøkonomi samlet her (UE-kost + fortjeneste
          bodde tidligere i en egen Kostnadsflyt-rad som dupliserte totalen). */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 divide-x divide-y xl:divide-y-0 divide-border border-t border-border mt-5">
        {/* EM-bidraget vises i EM netto-kortet — ingen duplisert undertekst her. */}
        <KpiTile
          label="Total ordreverdi"
          value={fmt(summary.totalContract)}
          context="inkl. godkjente EM"
        />
        <KpiTile
          label="Levert til nå"
          value={fmt(summary.delivered)}
          context={summary.totalContract > 0 ? `${Math.round((summary.delivered / summary.totalContract) * 100)}% av total` : '—'}
          tone="green"
        />
        <KpiTile
          label="Gjenstår"
          value={fmt(summary.remaining)}
          context={summary.totalContract > 0 ? `${Math.round((summary.remaining / summary.totalContract) * 100)}% av total` : '—'}
          tone={summary.remaining < summary.totalContract * 0.1 && summary.totalContract > 0 ? 'red' : 'default'}
        />
        <KpiTile
          label="EM netto"
          value={summary.approvedEMValue > 0 ? `+${fmt(summary.approvedEMValue)}` : fmt(0)}
          context={
            summary.pendingEMCount > 0
              ? `${summary.approvedEMCount} godkjent · ${summary.pendingEMCount} venter`
              : `${summary.approvedEMCount} godkjent`
          }
          tone={summary.approvedEMValue > 0 ? 'green' : 'default'}
        />
        <KpiTile
          label="UE-kostnad"
          value={fmt(summary.ueBudgetCost)}
          context={`Rapportert ${fmt(summary.ueReportedCost)}`}
        />
        <KpiTile
          label="Forventet fortjeneste"
          value={fmt(summary.expectedProfit)}
          context="ordre − UE − intern"
          tone={summary.expectedProfit >= 0 ? 'green' : 'red'}
        />
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
