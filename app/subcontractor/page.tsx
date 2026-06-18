import { Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import { CheckCircle2, Clock, Mail, Wallet, FileText, PiggyBank, ChevronRight, AlertCircle } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { getEffectiveUser } from '@/lib/view-as'
import { getSubcontractorDashboard, type DashboardPayload } from '@/lib/subcontractor-dashboard'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import { fmtNOK as fmt, fmtDateLong as fmtDate, fmtDateTime, daysUntil } from '@/lib/format'
import { changeOrderType, changeOrderStatus } from '@/lib/statuses'
import DashboardActions from './DashboardActions'

export const dynamic = 'force-dynamic'

interface PickerProjectLite {
  id: string
  name: string
  project_number: string
  pending_em_count: number
  pending_weekly_count: number
}

const EMPTY_DASHBOARD: DashboardPayload = {
  kpi: { ordreverdi: 0, fakturert: 0, fakturerbart: 0, gjenstaaende: 0, produsertIkkeBedt: 0 },
  pendingChangeOrders: [],
  revisionChangeOrders: [],
  pendingWeeklyReports: [],
  projects: [],
}

interface KpiCardProps {
  label: string
  value: string
  hint: string
  icon: ReactNode
  iconBg: string
  href?: string
}

function KpiCard({ label, value, hint, icon, iconBg, href }: KpiCardProps) {
  const body = (
    <>
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-none ${iconBg}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">{label}</p>
            {href && (
              <ChevronRight size={18} className="flex-none text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]" />
            )}
          </div>
          <p className="text-3xl font-bold text-[var(--color-text-primary)] mt-1 leading-tight tabular-nums">{value}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">{hint}</p>
        </div>
      </div>
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="group bg-card border border-border rounded-2xl p-5 hover:border-[var(--color-border-strong)] hover:shadow-sm transition-all"
      >
        {body}
      </Link>
    )
  }

  return <div className="bg-card border border-border rounded-2xl p-5">{body}</div>
}

/** Greeting block — shared by the live render and the skeleton so the header
 *  doesn't pop in. revisionCount drives the "hva venter på meg"-line. */
function Greeting({ userName, revisionCount }: { userName: string; revisionCount: number }) {
  const today = new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div>
      <p className="text-xs text-[var(--color-text-muted)] capitalize">{today}</p>
      <h1 className="text-xl font-bold text-[var(--color-text-primary)] mt-0.5">
        {userName ? `Hei, ${userName.split(' ')[0]}` : 'Oversikt'}
      </h1>
      {revisionCount > 0 ? (
        <p className="text-sm font-medium text-orange-700 mt-1 inline-flex items-center gap-1.5">
          <AlertCircle size={15} strokeWidth={2} />
          Du har {revisionCount} {revisionCount === 1 ? 'endringsmelding som må rettes' : 'endringsmeldinger som må rettes'}
        </p>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)] mt-1 inline-flex items-center gap-1.5">
          <CheckCircle2 size={15} strokeWidth={2} className="text-green-600" />
          Alt er à jour
        </p>
      )}
    </div>
  )
}

/** Skeleton shown while the dashboard aggregation runs server-side. Replaces
 *  the old full-screen «Laster…» blank with a structural placeholder so the
 *  KPI grid and lists don't collapse the layout on first paint. */
function DashboardSkeleton({ userName }: { userName: string }) {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <Greeting userName={userName} revisionCount={0} />

      <div className="space-y-4">
        <div className="h-3 w-28 rounded bg-muted" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-5 h-28" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-5 h-28" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-3">
            <div className="h-14 rounded-2xl bg-muted" />
            <div className="bg-card border border-border rounded-2xl h-40" />
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-2xl h-48" />
    </div>
  )
}

/** Pure presentational dashboard — takes a resolved payload and renders the
 *  full UE landing page. Reused by both the live RSC and the empty-state
 *  (view-as-without-sub) path. */
function DashboardView({ userName, dashboard }: { userName: string; dashboard: DashboardPayload }) {
  const pickerProjects: PickerProjectLite[] = dashboard.projects.map((p) => ({
    id: p.id,
    name: p.name,
    project_number: p.project_number,
    pending_em_count: p.pending_em_count,
    pending_weekly_count: p.pending_weekly_count,
  }))

  // S.2 — «Hva venter på meg». Kun revisjon teller som UE-egen oppgave;
  // «til behandling»-boksene venter på admin og holdes utenfor.
  const revisionCount = dashboard.revisionChangeOrders.length

  return (
    <div className="p-6 space-y-6">
      {/* Greeting */}
      <Greeting userName={userName} revisionCount={revisionCount} />

      {/* KPI-er — alle 5 fra payloaden, gruppert i budsjett-status vs kontantstrøm. */}
      <div className="space-y-4">
        {/* Budsjett-status: avtalt verdi → fakturert → gjenstår å fakturere */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Budsjett-status</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard
              label="Mitt budsjett"
              value={fmt(dashboard.kpi.ordreverdi)}
              hint="Avtalt verdi av arbeidet du er tildelt"
              icon={<Wallet size={22} className="text-slate-600" strokeWidth={1.75} />}
              iconBg="bg-slate-100"
            />
            <KpiCard
              label="Fakturert"
              value={fmt(dashboard.kpi.fakturert)}
              hint="Sum av dine registrerte fakturaer"
              icon={<FileText size={22} className="text-blue-600" strokeWidth={1.75} />}
              iconBg="bg-blue-50"
              href="/subcontractor/invoice-basis"
            />
            <KpiCard
              label="Gjenstår å fakturere"
              value={fmt(dashboard.kpi.gjenstaaende)}
              hint="Av budsjettet som ikke er fakturert ennå"
              icon={<PiggyBank size={22} className="text-violet-600" strokeWidth={1.75} />}
              iconBg="bg-violet-50"
              href="/subcontractor/invoice-basis"
            />
          </div>
        </section>

        {/* Kontantstrøm: klart til fakturering → venter på godkjenning */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Kontantstrøm</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <KpiCard
              label="Klart til fakturering"
              value={fmt(dashboard.kpi.fakturerbart)}
              hint="Godkjent arbeid som ikke er fakturert ennå"
              icon={<CheckCircle2 size={22} className="text-green-600" strokeWidth={1.75} />}
              iconBg="bg-green-50"
              href="/subcontractor/invoice-basis"
            />
            <KpiCard
              label="Venter på godkjenning"
              value={fmt(dashboard.kpi.produsertIkkeBedt)}
              hint="Innsendt arbeid som venter på godkjenning fra prosjektleder"
              icon={<Clock size={22} className="text-amber-600" strokeWidth={1.75} />}
              iconBg="bg-amber-50"
              href="/subcontractor/weekly-reports"
            />
          </div>
        </section>
      </div>

      {/* Two action columns — button on top, pending list below */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Ukesrapport */}
        <div className="space-y-3">
          <DashboardActions projects={pickerProjects} variant="weekly-report" />
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
          <DashboardActions projects={pickerProjects} variant="new-em" />
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
                {dashboard.revisionChangeOrders.map((co) => {
                  const t = changeOrderType(co.em_type)
                  return (
                  <li key={co.id}>
                    <Link
                      href={`/subcontractor/projects/${co.project_id}`}
                      className="block px-5 py-3 hover:bg-orange-50/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                              {co.em_title}
                            </p>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${t.cls}`}>{t.label}</span>
                            {co.has_admin_edits && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                                Endret av prosjektleder
                              </span>
                            )}
                            {co.has_consequence_lines && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">
                                Har konsekvens ved avslag
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                            {fmt(co.total_cost)}{co.submitted_by && ` · ${co.submitted_by}`} · {fmtDateTime(co.submitted_at)}
                          </p>
                          {co.admin_comment && (
                            <p className="text-xs text-orange-800 bg-orange-50 border border-orange-200 rounded p-2 mt-2 whitespace-pre-line">
                              <span className="font-semibold">Prosjektleder: </span>{co.admin_comment}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                  )
                })}
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
                {dashboard.pendingChangeOrders.map((co) => {
                  const t = changeOrderType(co.em_type)
                  const s = changeOrderStatus(co.status)
                  return (
                  <li key={co.id}>
                    <Link
                      href={`/subcontractor/projects/${co.project_id}`}
                      className="block px-5 py-3 hover:bg-muted transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                              {co.em_title}
                            </p>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${t.cls}`}>{t.label}</span>
                            {co.has_admin_edits && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                                Endret av prosjektleder
                              </span>
                            )}
                            {co.has_consequence_lines && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">
                                Har konsekvens ved avslag
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                            {fmt(co.total_cost)}{co.submitted_by && ` · ${co.submitted_by}`} · {fmtDateTime(co.submitted_at)}
                          </p>
                        </div>
                        <div className="text-right flex-none">
                          <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded-full ${s.cls}`}>
                            {s.label}
                          </span>
                        </div>
                      </div>
                    </Link>
                  </li>
                  )
                })}
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
    </div>
  )
}

/** Async server component — does the actual dashboard aggregation. Suspended
 *  on by the page so the skeleton shows while the queries run. subId comes from
 *  the effective session, never the client. */
async function DashboardBody({ subId, userName }: { subId: string; userName: string }) {
  const dashboard = await getSubcontractorDashboard(subId)
  return <DashboardView userName={userName} dashboard={dashboard} />
}

/**
 * UE-dashbord — server-komponent (RSC). Sesjonen og view-as løses server-side
 * (samme måte som layouten), og subId hentes fra den effektive brukeren —
 * aldri fra klienten. De interaktive «Send EM»/«Send ukesrapport»-knappene er
 * trukket ut som klient-øyer (DashboardActions). Dataspørringen kjøres i
 * DashboardBody bak en Suspense-grense, så et skjelett vises i stedet for den
 * gamle full-skjerm «Laster…»-blanken.
 *
 * Rollegaten ligger i subcontractor/layout.tsx (redirecter ikke-subs bort før
 * siden lastes). Her håndteres bare view-as-uten-sub_id ved å vise et tomt
 * dashbord i stedet for å hente data.
 */
export default async function SubcontractorPage() {
  const realUser = await getSession()
  // Layouten gater allerede ut alt som ikke er en effektiv sub; dette er bare
  // en defensiv guard hvis siden rendres uten økt.
  if (!realUser) {
    return <DashboardView userName="" dashboard={EMPTY_DASHBOARD} />
  }
  const me = await getEffectiveUser(realUser)
  const userName = me.full_name ?? ''

  // View-as-preview uten sub_id — vis tomt dashbord i stedet for å hente data
  // (speiler den gamle klient-oppførselen).
  if (me.role !== 'sub' || !me.subcontractor_id) {
    return <DashboardView userName={userName} dashboard={EMPTY_DASHBOARD} />
  }

  return (
    <Suspense fallback={<DashboardSkeleton userName={userName} />}>
      <DashboardBody subId={me.subcontractor_id} userName={userName} />
    </Suspense>
  )
}
