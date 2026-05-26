'use client'

import Link from 'next/link'
import { Bell, FileText, AlertCircle, ChevronRight, BarChart3 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type AttentionItem =
  | {
      kind: 'weekly_report'
      count: number
      week: number
      submittedBy: number // number of distinct subs
    }
  | {
      kind: 'change_order'
      count: number
    }
  | {
      kind: 'margin_warning'
      count: number
      projectName: string
      projectId: string
    }

interface RowProps {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  title: string
  sub: string
  href: string
}

function Row({ icon: Icon, iconBg, iconColor, title, sub, href }: RowProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-5 py-3 hover:bg-muted transition-colors"
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-none ${iconBg}`}>
        <Icon size={16} className={iconColor} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{title}</p>
        <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{sub}</p>
      </div>
      <ChevronRight size={16} className="text-[var(--color-text-muted)] flex-none" />
    </Link>
  )
}

interface Props {
  items: AttentionItem[]
}

/**
 * Unified action-needed feed. Whatever needs admin attention right now —
 * pending reports, pending change orders, margin warnings — surface here
 * so the admin doesn't have to bounce between three different cards to
 * see what's blocking them.
 */
export default function AttentionFeed({ items }: Props) {
  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex-1">
          Krever oppmerksomhet
        </h2>
        <Bell size={16} className="text-[var(--color-text-muted)]" />
      </div>
      {items.length === 0 ? (
        <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
          Ingenting krever oppmerksomhet akkurat nå ✓
        </div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item, i) => {
            if (item.kind === 'weekly_report') {
              return (
                <Row
                  key={i}
                  icon={FileText}
                  iconBg="bg-red-50"
                  iconColor="text-red-600"
                  title={`${item.count} ${item.count === 1 ? 'ukesrapport' : 'ukesrapporter'} til godkjenning`}
                  sub={`Uke ${item.week} · innsendt av ${item.submittedBy} ${item.submittedBy === 1 ? 'UE' : 'UE-er'}`}
                  href="/admin/weekly-reports"
                />
              )
            }
            if (item.kind === 'change_order') {
              return (
                <Row
                  key={i}
                  icon={FileText}
                  iconBg="bg-amber-50"
                  iconColor="text-amber-600"
                  title={`${item.count} ${item.count === 1 ? 'endringsmelding venter' : 'endringsmeldinger venter'}`}
                  sub="Krever din godkjenning"
                  href="/admin/change-orders"
                />
              )
            }
            return (
              <Row
                key={i}
                icon={item.count > 1 ? AlertCircle : BarChart3}
                iconBg="bg-blue-50"
                iconColor="text-blue-600"
                title={`Margin under mål på ${item.count} ${item.count === 1 ? 'prosjekt' : 'prosjekter'}`}
                sub={item.projectName}
                href={`/admin/projects/${item.projectId}`}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
