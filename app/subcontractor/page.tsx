'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock, Send, Plus, Mail } from 'lucide-react'
import ProjectPickerModal from '@/components/subcontractor/ProjectPickerModal'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import { fmtNOK as fmt } from '@/lib/format'
import { useMe } from '@/lib/useMe'

interface ProjectManager { id: string; full_name: string; email: string }

interface PickerProjectLite {
  id: string
  name: string
  project_number: string
  pending_em_count: number
  pending_weekly_count: number
}

interface DashboardProject {
  id: string
  name: string
  project_number: string
  end_date: string | null
  order_value: number
  approved_value: number
  progress_pct: number
  pending_em_count: number
  pending_weekly_count: number
  project_managers: ProjectManager[]
}

interface DashboardPayload {
  kpi: {
    ordreverdi: number
    fakturert: number
    fakturerbart: number
    gjenstaaende: number
    produsertIkkeBedt: number
  }
  pendingChangeOrders: Array<{
    id: string
    project_id: string
    project_name: string
    project_number: string
    em_title: string
    change_order_number: number
    product_name: string
    quantity: number
    unit: string
    total_cost: number
    submitted_at: string | null
  }>
  revisionChangeOrders: Array<{
    id: string
    project_id: string
    project_name: string
    project_number: string
    em_title: string
    change_order_number: number
    product_name: string
    quantity: number
    unit: string
    total_cost: number
    admin_comment: string
    submitted_at: string | null
  }>
  pendingWeeklyReports: Array<{
    id: string
    project_id: string
    project_name: string
    project_number: string
    year: number
    week_number: number
    submission_number: number
    line_count: number
    total_cost: number
    submitted_at: string | null
  }>
  projects: DashboardProject[]
}

const EMPTY_DASHBOARD: DashboardPayload = {
  kpi: { ordreverdi: 0, fakturert: 0, fakturerbart: 0, gjenstaaende: 0, produsertIkkeBedt: 0 },
  pendingChangeOrders: [],
  revisionChangeOrders: [],
  pendingWeeklyReports: [],
  projects: [],
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })
}

function daysUntil(s: string | null | undefined): number | null {
  if (!s) return null
  const ms = new Date(s).getTime() - new Date().getTime()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

export default function SubcontractorPage() {
  const router = useRouter()
  const { me } = useMe()
  const [dashboard, setDashboard] = useState<DashboardPayload>(EMPTY_DASHBOARD)
  const [loading, setLoading] = useState(true)
  const [picker, setPicker] = useState<'new-em' | 'weekly-report' | null>(null)

  const userName = me?.full_name ?? ''

  const fetchAll = useCallback(async (subId: string) => {
    const res = await fetch(`/api/subcontractor/dashboard?subcontractor_id=${subId}`)
    if (res.ok) {
      const data = await res.json() as DashboardPayload
      setDashboard(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!me) return
    if (me.role !== 'sub') { router.replace('/login'); return }
    // View-as preview without a sub_id — show empty state instead of bouncing.
    if (!me.subcontractor_id) { setLoading(false); return }
    fetchAll(me.subcontractor_id)
  }, [me, router, fetchAll])

  const pickerProjects: PickerProjectLite[] = dashboard.projects.map((p) => ({
    id: p.id,
    name: p.name,
    project_number: p.project_number,
    pending_em_count: p.pending_em_count,
    pending_weekly_count: p.pending_weekly_count,
  }))

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[var(--color-text-muted)]">Laster...</div>
  }

  const today = new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="p-6 space-y-6">
      {/* Greeting */}
      <div>
        <p className="text-xs text-[var(--color-text-muted)] capitalize">{today}</p>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)] mt-0.5">
          {userName ? `Hei, ${userName.split(' ')[0]}` : 'Oversikt'}
        </h1>
      </div>

      {/* Two big KPI cards — cash-flow focused */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5 flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-none bg-green-50">
            <CheckCircle2 size={22} className="text-green-600" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">Du har dette du kan fakturere</p>
            <p className="text-3xl font-bold text-[var(--color-text-primary)] mt-1 leading-tight">{fmt(dashboard.kpi.fakturerbart)}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">Godkjent arbeid som ikke er fakturert ennå</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-2xl p-5 flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-none bg-amber-50">
            <Clock size={22} className="text-amber-600" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">Du har dette du har produsert men ikke bedt om å fakturere</p>
            <p className="text-3xl font-bold text-[var(--color-text-primary)] mt-1 leading-tight">{fmt(dashboard.kpi.produsertIkkeBedt)}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">Innsendt arbeid som venter på admin-godkjenning</p>
          </div>
        </div>
      </div>

      {/* Two action columns — button on top, pending list below */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Ukesrapport */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setPicker('weekly-report')}
            disabled={pickerProjects.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 text-base font-semibold bg-primary text-white rounded-2xl hover:bg-primary-hover transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            <Send size={20} strokeWidth={2.25} /> Send ukesrapport
          </button>
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Ukesrapporter til behandling</h2>
              {dashboard.pendingWeeklyReports.length > 0 && (
                <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                  {dashboard.pendingWeeklyReports.length}
                </span>
              )}
            </div>
            {dashboard.pendingWeeklyReports.length === 0 ? (
              <EmptyState title="Ingen til behandling" description="Alle dine ukesrapporter er behandlet." />
            ) : (
              <ul className="divide-y divide-border">
                {dashboard.pendingWeeklyReports.map((wr) => (
                  <li key={wr.id}>
                    <Link
                      href={`/subcontractor/projects/${wr.project_id}`}
                      className="block px-5 py-3 hover:bg-muted transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            Uke {wr.week_number} {wr.year}
                            {wr.submission_number > 1 && <span className="text-[var(--color-text-muted)] font-normal"> · innsending #{wr.submission_number}</span>}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                            {wr.project_name} · {wr.line_count} {wr.line_count === 1 ? 'linje' : 'linjer'}
                          </p>
                        </div>
                        <div className="text-right flex-none">
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{fmt(wr.total_cost)}</p>
                          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{fmtDate(wr.submitted_at)}</p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* RIGHT: Endringsmelding */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setPicker('new-em')}
            disabled={pickerProjects.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 text-base font-semibold bg-amber-500 text-white rounded-2xl hover:bg-amber-600 transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            <Plus size={20} strokeWidth={2.5} /> Send endringsmelding
          </button>
          {/* Trenger revisjon — admin har returnert EMer som UE må rette opp og
              sende inn på nytt. Skilles fra "til behandling" så denne
              oppgaveboksen tydelig sier "DU har jobb å gjøre". */}
          {dashboard.revisionChangeOrders.length > 0 && (
            <Card className="overflow-hidden border-orange-200">
              <div className="px-5 py-3 border-b border-orange-200 bg-orange-50 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-orange-900">Trenger revisjon</h2>
                <span className="bg-orange-200 text-orange-800 text-xs font-semibold px-2 py-0.5 rounded-full">
                  {dashboard.revisionChangeOrders.length}
                </span>
              </div>
              <ul className="divide-y divide-orange-100">
                {dashboard.revisionChangeOrders.map((co) => (
                  <li key={co.id}>
                    <Link
                      href={`/subcontractor/projects/${co.project_id}`}
                      className="block px-5 py-3 hover:bg-orange-50/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {co.em_title}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                            {co.product_name} · {co.quantity} {co.unit}
                          </p>
                          {co.admin_comment && (
                            <p className="text-xs text-orange-800 bg-orange-50 border border-orange-200 rounded p-2 mt-2 whitespace-pre-line">
                              <span className="font-semibold">Admin: </span>{co.admin_comment}
                            </p>
                          )}
                        </div>
                        <div className="text-right flex-none">
                          <p className="text-[10px] text-orange-700 font-semibold uppercase tracking-wide">Åpne →</p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Endringsmeldinger til behandling</h2>
              {dashboard.pendingChangeOrders.length > 0 && (
                <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                  {dashboard.pendingChangeOrders.length}
                </span>
              )}
            </div>
            {dashboard.pendingChangeOrders.length === 0 ? (
              <EmptyState title="Ingen til behandling" description="Alle dine endringsmeldinger er behandlet." />
            ) : (
              <ul className="divide-y divide-border">
                {dashboard.pendingChangeOrders.map((co) => (
                  <li key={co.id}>
                    <Link
                      href={`/subcontractor/projects/${co.project_id}`}
                      className="block px-5 py-3 hover:bg-muted transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {co.em_title}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                            {co.product_name} · {co.quantity} {co.unit}
                          </p>
                        </div>
                        <div className="text-right flex-none">
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{fmt(co.total_cost)}</p>
                          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{fmtDate(co.submitted_at)}</p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* Mine prosjekter — % gjennomført + omsetning + kontaktperson + frist */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Mine prosjekter</h2>
          <Link href="/subcontractor/projects" className="text-xs text-primary hover:underline font-medium">
            Se alle
          </Link>
        </div>
        {dashboard.projects.length === 0 ? (
          <EmptyState
            title="Ingen prosjekter tildelt ennå"
            description="Du blir lagt til på prosjekter av en administrator."
          />
        ) : (
          <ul className="divide-y divide-border">
            {dashboard.projects.map((p) => {
              const contact = p.project_managers[0]
              const extraContacts = p.project_managers.length > 1 ? ` +${p.project_managers.length - 1}` : ''
              const days = daysUntil(p.end_date)
              const overdue = days !== null && days < 0
              const soon = days !== null && days >= 0 && days <= 14
              return (
                <li key={p.id}>
                  <Link
                    href={`/subcontractor/projects/${p.id}`}
                    className="block px-5 py-4 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4 mb-2.5">
                      <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{p.name}</p>
                      <p className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums flex-none">{fmt(p.order_value)}</p>
                    </div>
                    {/* Progress bar */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${Math.max(0, Math.min(100, p.progress_pct))}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-[var(--color-text-secondary)] tabular-nums flex-none w-12 text-right">
                        {p.progress_pct}% utført
                      </span>
                    </div>
                    {/* Meta line */}
                    <div className="flex items-center gap-3 flex-wrap text-xs text-[var(--color-text-muted)]">
                      {contact ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Mail size={11} />
                          <span className="text-[var(--color-text-secondary)] font-medium">{contact.full_name}{extraContacts}</span>
                        </span>
                      ) : (
                        <span className="italic">Ingen kontaktperson</span>
                      )}
                      {p.end_date && (
                        <span className={`inline-flex items-center gap-1 ${overdue ? 'text-red-600 font-semibold' : soon ? 'text-amber-600 font-medium' : ''}`}>
                          Frist: {fmtDate(p.end_date)}
                          {days !== null && (
                            <span className="ml-1">
                              ({overdue ? `${Math.abs(days)}d forsinket` : days === 0 ? 'i dag' : `${days}d igjen`})
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {picker && (
        <ProjectPickerModal
          projects={pickerProjects}
          action={picker}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
