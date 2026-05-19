'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { CHART_AXIS_TICK, CHART_BRAND, CHART_TEXT_SECONDARY, CHART_BORDER } from '@/lib/chart-colors'

export type WeekPoint = { week: string; omsetning: number; kostnad: number }

function fmtAxis(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export default function DashboardChart({ data }: { data: WeekPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="week"
          tick={CHART_AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={fmtAxis}
          tick={CHART_AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          formatter={(v, name) => [
            (Number(v)).toLocaleString('nb-NO') + ' kr',
            name === 'omsetning' ? 'Omsetning' : 'UE-kostnad',
          ]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${CHART_BORDER}`, boxShadow: '0 2px 8px rgba(0,0,0,.08)' }}
        />
        <Legend
          iconType="line"
          iconSize={12}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(v) => (v === 'omsetning' ? 'Omsetning' : 'UE-kostnad')}
        />
        <Line
          type="monotone"
          dataKey="omsetning"
          stroke={CHART_BRAND}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: CHART_BRAND }}
        />
        <Line
          type="monotone"
          dataKey="kostnad"
          stroke={CHART_TEXT_SECONDARY}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: CHART_TEXT_SECONDARY }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
