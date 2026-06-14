'use client'

import Link from 'next/link'
import { TrendingUp, Receipt, Calculator, PieChart, ClipboardCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

function fmt(n: number) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(n)
}

interface KpiCardProps {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  label: string
  value: string
  sub: string
  href?: string
}

function KpiCard({ icon: Icon, iconBg, iconColor, label, value, sub, href }: KpiCardProps) {
  const body = (
    <>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${iconBg}`}>
        <Icon size={20} className={iconColor} strokeWidth={1.75} />
      </div>
      <div className="mt-4">
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">{label}</p>
        <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1 leading-tight">{value}</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">{sub}</p>
      </div>
    </>
  )
  if (href) {
    return (
      <Link href={href} className="block bg-card border border-border rounded-2xl p-5 hover:shadow-md transition-shadow">
        {body}
      </Link>
    )
  }
  return <div className="bg-card border border-border rounded-2xl p-5">{body}</div>
}

interface Props {
  yearRevenue: number
  yearInvoiced: number
  yearCost: number
  yearProfit: number
  profitMargin: number
  pendingReports: number
  pendingCOCount: number
  submittedThisWeek: number
  currentWeek: number
}

export default function DashboardKpiCardsV2({
  yearRevenue,
  yearInvoiced,
  yearCost,
  yearProfit,
  profitMargin,
  pendingReports,
  pendingCOCount,
  submittedThisWeek,
  currentWeek,
}: Props) {
  const pendingTotal = pendingReports + pendingCOCount
  const invoicedPct = yearRevenue > 0 ? Math.round((yearInvoiced / yearRevenue) * 100) : 0
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      <KpiCard
        icon={TrendingUp}
        iconBg="bg-blue-50"
        iconColor="text-blue-600"
        label="Omsetning"
        value={fmt(yearRevenue)}
        sub="Klikk for fordeling →"
        href="/admin/invoice-basis?type=customer"
      />
      <KpiCard
        icon={Receipt}
        iconBg="bg-cyan-50"
        iconColor="text-cyan-600"
        label="Fakturert"
        value={fmt(yearInvoiced)}
        sub={yearRevenue > 0 ? `${invoicedPct}% av omsetning` : 'hittil i år'}
      />
      <KpiCard
        icon={Calculator}
        iconBg="bg-purple-50"
        iconColor="text-purple-600"
        label="UE-kostnad"
        value={fmt(yearCost)}
        sub="Klikk for fordeling →"
        href="/admin/invoice-basis?type=ue"
      />
      <KpiCard
        icon={PieChart}
        iconBg="bg-green-50"
        iconColor="text-green-600"
        label="Fortjeneste"
        value={fmt(yearProfit)}
        sub={`Margin ${profitMargin}%`}
      />
      <KpiCard
        icon={ClipboardCheck}
        iconBg="bg-amber-50"
        iconColor="text-amber-600"
        label="Til godkjenning"
        value={String(pendingTotal)}
        sub={submittedThisWeek > 0
          ? `${submittedThisWeek} innsendt uke ${currentWeek}`
          : `Uke ${currentWeek} · ingen nye innsendelser`}
        href={pendingTotal > 0 ? '/admin/weekly-reports' : undefined}
      />
    </div>
  )
}
