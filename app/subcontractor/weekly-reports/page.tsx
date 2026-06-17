'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, AlertTriangle, ClipboardList } from 'lucide-react'
import Card from '@/components/ui/Card'
import StatusPill from '@/components/ui/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import { useMe } from '@/lib/useMe'
import { getCurrentWeek, prevWeek, nextWeek, formatWeekLabel } from '@/lib/utils/weeks'
import type { WeeklyReport, WeeklyReportStatus } from '@/types'

// Only the project fields this page needs from /api/subcontractor/projects.
// The endpoint returns the UE's own cost figures (budget_value etc.) — none of
// which we render here, so no customer economics ever reach this view.
type SubProject = {
  id: string
  name: string
  project_number: string
  status: string
}

// Per-project status for the selected week, derived from that week's report.
// «not_reported» is the synthetic state for projects with no report yet — it's
// the whole point of the page (what's still missing this week).
type WeekStatus = 'not_reported' | 'draft' | 'submitted' | 'approved'

type ProjectWeekRow = {
  id: string
  name: string
  project_number: string
  weekStatus: WeekStatus
  // The report's own status word for the pill (only set when a report exists).
  reportStatus: WeeklyReportStatus | null
}

// Map a weekly_report status onto the four landing-page buckets. Both
// partially_approved and approved count as «Godkjent» here — the project
// detail page shows the per-line nuance; the cross-project overview only
// needs the coarse "is this week handled?" signal.
function weekStatusFromReport(status: WeeklyReportStatus): WeekStatus {
  switch (status) {
    case 'draft':
      return 'draft'
    case 'submitted':
      return 'submitted'
    case 'approved':
    case 'partially_approved':
      return 'approved'
    case 'rejected':
      // A rejected report means the week still needs the UE's attention, so
      // surface it as a draft-equivalent task rather than hiding it.
      return 'draft'
    default:
      return 'not_reported'
  }
}

const WEEK_STATUS_META: Record<WeekStatus, { label: string; tone: 'gray' | 'amber' | 'blue' | 'green' }> = {
  not_reported: { label: 'Ikke rapportert', tone: 'gray' },
  draft: { label: 'Kladd', tone: 'amber' },
  submitted: { label: 'Innsendt', tone: 'blue' },
  approved: { label: 'Godkjent', tone: 'green' },
}

/**
 * UE-landingsside for ukesrapporter på tvers av prosjekter (motstykke til
 * admin-køen). Ukesnavigator øverst + liste over aktive prosjekter for valgt
 * uke med status-badge. Hver rad lenker til prosjektets rapport-fane og
 * starter en kladd via ?action=weekly-report (PB3-kontrakten).
 *
 * ISOLASJON: viser kun UE-egne data. Begge endepunktene scopes til UE-ens
 * subcontractor_id, og ingen kosttall/kundepris rendres på denne siden.
 */
export default function SubcontractorWeeklyReportsPage() {
  const { me } = useMe()
  const subId = me?.subcontractor_id ?? ''

  const [{ year, week }, setSelected] = useState(() => {
    const cur = getCurrentWeek()
    return { year: cur.year, week: cur.week }
  })

  const [projects, setProjects] = useState<SubProject[]>([])
  const [reports, setReports] = useState<WeeklyReport[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async (sub: string, y: number, w: number) => {
    setLoading(true)
    const safe = async <T,>(url: string): Promise<T[]> => {
      try {
        const res = await fetch(url)
        if (!res.ok) return []
        const data = await res.json()
        return Array.isArray(data) ? (data as T[]) : []
      } catch {
        return []
      }
    }
    const [proj, reps] = await Promise.all([
      safe<SubProject>(`/api/subcontractor/projects?subcontractor_id=${sub}`),
      // /api/weekly-reports scopes to the UE's own subcontractor_id for the
      // 'sub' role server-side; year/week_number narrow it to the chosen week.
      safe<WeeklyReport>(`/api/weekly-reports?subcontractor_id=${sub}&year=${y}&week_number=${w}`),
    ])
    setProjects(proj)
    setReports(reps)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!me) return
    // Server layout is the authoritative role gate; don't redirect here or we
    // race the ViewAsBar navigation when exiting view-as. Just skip the fetch.
    if (me.role !== 'sub') return
    // View-as preview: super-admin posing as `sub` has no subcontractor_id.
    if (!subId) {
      setLoading(false)
      return
    }
    fetchData(subId, year, week)
  }, [me, subId, year, week, fetchData])

  // One row per ACTIVE project, with its status for the selected week. Closed
  // projects can't be reported against (the POST gate rejects them), so they're
  // left out of the "what to report this week" view.
  const rows: ProjectWeekRow[] = useMemo(() => {
    const reportByProject = new Map<string, WeeklyReport>()
    for (const r of reports) {
      // Defensive: the endpoint already filters by year/week, but guard anyway.
      if (r.year !== year || r.week_number !== week) continue
      const existing = reportByProject.get(r.project_id)
      // If a project somehow has multiple submissions in one week, keep the most
      // advanced one so the badge reflects the furthest-along status.
      if (!existing || rank(r.status) > rank(existing.status)) {
        reportByProject.set(r.project_id, r)
      }
    }
    return projects
      .filter((p) => p.status === 'active')
      .map((p) => {
        const rep = reportByProject.get(p.id) ?? null
        return {
          id: p.id,
          name: p.name,
          project_number: p.project_number,
          weekStatus: rep ? weekStatusFromReport(rep.status) : 'not_reported',
          reportStatus: rep ? rep.status : null,
        }
      })
      .sort((a, b) => {
        // Surface not-reported projects first — that's the UE's task this week.
        const ord = (s: WeekStatus) => (s === 'not_reported' ? 0 : s === 'draft' ? 1 : 2)
        const d = ord(a.weekStatus) - ord(b.weekStatus)
        return d !== 0 ? d : a.name.localeCompare(b.name, 'nb')
      })
  }, [projects, reports, year, week])

  const notReportedCount = rows.filter((r) => r.weekStatus === 'not_reported').length
  const draftCount = rows.filter((r) => r.weekStatus === 'draft').length
  const submittedCount = rows.filter((r) => r.weekStatus === 'submitted').length
  const approvedCount = rows.filter((r) => r.weekStatus === 'approved').length

  function goPrev() {
    setSelected(prevWeek(year, week))
  }
  function goNext() {
    setSelected(nextWeek(year, week))
  }
  function goCurrent() {
    const cur = getCurrentWeek()
    setSelected({ year: cur.year, week: cur.week })
  }

  const isCurrentWeek = useMemo(() => {
    const cur = getCurrentWeek()
    return cur.year === year && cur.week === week
  }, [year, week])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Ukesrapporter</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Rapporteringsstatus for dine aktive prosjekter, uke for uke
        </p>
      </div>

      {/* Ukesnavigator — forrige/neste uke med delte ISO-uke-hjelpere. */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goPrev}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border text-[var(--color-text-secondary)] hover:bg-muted transition-colors"
              aria-label="Forrige uke"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="min-w-[200px] text-center">
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                {formatWeekLabel(year, week)}
              </span>
            </div>
            <button
              type="button"
              onClick={goNext}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border text-[var(--color-text-secondary)] hover:bg-muted transition-colors"
              aria-label="Neste uke"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={goCurrent}
              className="text-xs font-medium text-primary hover:underline"
            >
              Gå til denne uka
            </button>
          )}
        </div>
      </Card>

      {/* «Mangler rapportering»-indikasjon: tell ikke-rapporterte øverst. */}
      {!loading && rows.length > 0 && notReportedCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-orange-200 bg-orange-50 text-orange-800">
          <AlertTriangle size={18} className="flex-none text-orange-600" />
          <p className="text-sm flex-1">
            <span className="font-semibold">{notReportedCount}</span>{' '}
            {notReportedCount === 1 ? 'aktivt prosjekt mangler' : 'aktive prosjekter mangler'} rapportering for{' '}
            {formatWeekLabel(year, week).toLowerCase()}.
          </p>
        </div>
      )}

      {/* Statusteller-linje — speiler admin-køens teller, men per uke. */}
      {!loading && rows.length > 0 && (
        <p className="text-sm text-[var(--color-text-muted)]">
          {notReportedCount} ikke rapportert · {draftCount} kladd · {submittedCount} innsendt · {approvedCount} godkjent
        </p>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--color-text-muted)]">Laster...</div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={28} strokeWidth={1.5} />}
            title="Ingen aktive prosjekter"
            description="Du blir lagt til på prosjekter av en administrator. Rapportering blir tilgjengelig når du har et aktivt prosjekt."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Prosjekt', 'Nummer', 'Status', ''].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const meta = WEEK_STATUS_META[row.weekStatus]
                  // PB3-kontrakten: ?action=weekly-report åpner rapport-fanen og
                  // starter en kladd på prosjektsiden.
                  const href = `/subcontractor/projects/${row.id}?action=weekly-report`
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-border last:border-0 hover:bg-muted transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <Link href={href} className="font-medium text-[var(--color-text-primary)] hover:text-primary">
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{row.project_number}</td>
                      <td className="px-4 py-2.5">
                        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link href={href} className="text-xs text-primary hover:underline font-medium whitespace-nowrap">
                          {row.weekStatus === 'not_reported'
                            ? 'Start rapport →'
                            : row.weekStatus === 'draft'
                              ? 'Fortsett kladd →'
                              : 'Åpne rapport →'}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// Status ordering used when collapsing multiple submissions for one project in
// one week down to a single badge: keep the most advanced status.
function rank(status: WeeklyReportStatus): number {
  switch (status) {
    case 'approved':
      return 4
    case 'partially_approved':
      return 3
    case 'submitted':
      return 2
    case 'rejected':
      return 1
    case 'draft':
    default:
      return 0
  }
}
