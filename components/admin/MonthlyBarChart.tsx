'use client'

import { memo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { CHART_AXIS_TICK, CHART_TEXT_SECONDARY, CHART_BORDER } from '@/lib/chart-colors'

export interface MonthBucket {
  month: number
  label: string
  omsetning: number
  kostnad: number
  fakturert: number
}

function fmtAxis(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function fmtTooltip(n: number) {
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency: 'NOK',
    maximumFractionDigits: 0,
  }).format(n)
}

/**
 * Year-wide bar chart bucketed per month — three grouped bars per month
 * for revenue / cost / invoiced. Memoized because the parent re-renders
 * when the period switcher above changes, but THIS chart's data is
 * year-fixed and doesn't depend on the switcher.
 */
function MonthlyBarChart({ data }: { data: MonthBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={CHART_BORDER} vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: CHART_AXIS_TICK }}
          axisLine={{ stroke: CHART_BORDER }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={fmtAxis}
          tick={{ fontSize: 11, fill: CHART_AXIS_TICK }}
          axisLine={{ stroke: CHART_BORDER }}
          tickLine={false}
        />
        <Tooltip
          formatter={(value: number, name) => [fmtTooltip(value), name]}
          contentStyle={{ borderColor: CHART_BORDER, borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: CHART_TEXT_SECONDARY, fontWeight: 600 }}
          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
        <Bar dataKey="omsetning" name="Omsetning" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="kostnad" name="Kostnad" fill="#a78bfa" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="fakturert" name="Fakturert" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export default memo(MonthlyBarChart)
