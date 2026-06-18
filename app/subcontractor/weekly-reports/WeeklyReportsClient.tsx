'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, AlertTriangle, ClipboardList } from 'lucide-react'
import Card from '@/components/ui/Card'
import StatusPill from '@/components/ui/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import { getCurrentWeek, prevWeek, nextWeek, formatWeekLabel } from '@/lib/utils/weeks'
import type { WeeklyReport, WeeklyReportStatus } from '@/types'
import type { SubProjectLite } from '@/lib/subcontractor-weekly-reports'

// Per-project status for the selected week, derived from that week's report.
type WeekStatus = 'not_reported' | 'draft' | 'submitted' | 'approved'

type ProjectWeekRow = {
  id: string
  name: string
  project_number: string
  weekStatus: WeekStatus
  reportStatus: WeeklyReportStatus | null
}

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
      return 'draft'
    default:
      return 'not_reported'
  }
}

function rank(status: WeeklyReportStatus): number {
  switch (status) {
    case 'approved': return 4
    case 'partially_approved': return 3
    case 'submitted': return 2
    case 'rejected': return 1
    case 'draft':
    default: return 0
  }
}

const WEEK_STATUS_META: Record<WeekStatus, { label: string; tone: 'gray' | 'amber' | 'blue' | 'green' }> = {
  not_reported: { label: 'Ikke rapportert', tone: 'gray' },
  draft: { label: 'Kladd', tone: 'amber' },
  submitted: { label: 'Innsendt', tone: 'blue' },
  approved: { label: 'Godkjent', tone: 'green' },
}

interface Props {
  /** sub's subcontractor_id — resolved server-side, never from URL/cookie. */
  subId: string
  /** Pre-fetched projects list for the initial week (current week). */
  initialProjects: SubProjectLite[]
  /** Pre-fetched weekly reports for the initial week. */
  initialReports: WeeklyReport[]
  /** The ISO year for the initial (server-fetched) week. */
  initialYear: number
  /** The ISO week number for the initial (server-fetched) week. */
  initialWeek: number
}

/**
 * Client island for the UE weekly-reports list.
 *
 * The INITIAL load is seeded from server-fetched data (no blank screen).
 * When the user navigates to a different week the island fetches client-side
 * via /api/subcontractor/projects and /api/weekly-reports — identical to the
 * old behaviour, just not on mount.
 *
 * The projects list does not change per-week so it is loaded once and kept; only
 * the reports are re-fetched on week navigation.
 *
 * UE-PRIS-ISOLASJON: neither projects nor weekly reports carry customer-price
 * fields, so no stripping is needed here. The server loader confirms this.
 */
export default function WeeklyReportsClient({
  subId,
  initialProjects,
  initialReports,
  initialYear,
  initialWeek,
}: Props) {
  const [{ year, week }, setSelected] = useState({ year: initialYear, week: initialWeek })
  const [projects] = useState<SubProjectLite[]>(initialProjects)
  const [reports, setReports] = useState<WeeklyReport[]>(initialReports)
  // loading is only true while week-navigation fetches are in flight — not on
  // initial render because the data is already seeded.
  const [loading, setLoading] = useState(false)

  // When the user navigates weeks we fetch only the reports for that week (the
  // projects list is stable). If subId is empty (view-as without a sub) we skip.
  const fetchReportsForWeek = useCallback(async (sub: string, y: number, w: number) => {
    if (!sub) {
      setReports([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
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
      const reps = await safe<WeeklyReport>(
        `/api/weekly-reports?subcontractor_id=${sub}&year=${y}&week_number=${w}`,
      )
      setReports(reps)
    } finally {
      setLoading(false)
    }
  }, [])

  // Re-fetch when the user navigates away from the initial seeded week.
  useEffect(() => {
    if (year === initialYear && week === initialWeek) return
    fetchReportsForWeek(subId, year, week)
  }, [subId, year, week, initialYear, initialWeek, fetchReportsForWeek])

  const rows: ProjectWeekRow[] = useMemo(() => {
    const reportByProject = new Map<string, WeeklyReport>()
    for (const r of reports) {
      if (r.year !== year || r.week_number !== week) continue
      const existing = reportByProject.get(r.project_id)
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
        const ord = (s: WeekStatus) => (s === 'not_reported' ? 0 : s === 'draft' ? 1 : 2)
        const d = ord(a.weekStatus) - ord(b.weekStatus)
        return d !== 0 ? d : a.name.localeCompare(b.name, 'nb')
      })
  }, [projects, reports, year, week])

  const notReportedCount = rows.filter((r) => r.weekStatus === 'not_reported').length
  const draftCount = rows.filter((r) => r.weekStatus === 'draft').length
  const submittedCount = rows.filter((r) => r.weekStatus === 'submitted').length
  const approvedCount = rows.filter((r) => r.weekStatus === 'approved').length

  function goPrev() { setSelected(prevWeek(year, week)) }
  function goNext() { setSelected(nextWeek(year, week)) }
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
