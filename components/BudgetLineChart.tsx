'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { CHART_AXIS_TICK, CHART_LINE_ACCENT, CHART_REFERENCE_LINE } from '@/lib/chart-colors'

type COEvent = {
  id: string
  reviewed_at: string | null
  requested_quantity: number
  reason: string
  reviewed_by: string | null
}

type Props = {
  productName: string
  productCode?: string
  unit: string
  subName?: string
  importQty: number
  projectStart: string
  approvedCOs: COEvent[]
  onClose?: () => void
}

type ChartPoint = {
  date: string
  quantity: number
  label: string
  delta?: number
  reviewedBy?: string | null
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function BudgetLineChart({ productName, productCode, unit, subName, importQty, projectStart, approvedCOs, onClose }: Props) {
  const points: ChartPoint[] = [
    { date: projectStart, quantity: importQty, label: 'Opprinnelig import' },
  ]
  let running = importQty
  for (const co of approvedCOs) {
    running += co.requested_quantity
    points.push({
      date: co.reviewed_at!.split('T')[0],
      quantity: running,
      label: co.reason,
      delta: co.requested_quantity,
      reviewedBy: co.reviewed_by,
    })
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            Mengdehistorikk — {productName}
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {productCode && `${productCode} · `}{unit}{subName && ` · ${subName}`}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-lg leading-none flex-none">✕</button>
        )}
      </div>

      {approvedCOs.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">
          Ingen godkjente endringsmeldinger for dette produktet ennå.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={CHART_AXIS_TICK}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={CHART_AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as ChartPoint
                return (
                  <div className="bg-white border border-border rounded-lg shadow-lg px-3 py-2 text-xs space-y-1 max-w-[200px]">
                    <p className="font-semibold text-[var(--color-text-primary)]">{fmtDate(d.date)}</p>
                    <p className="text-[var(--color-text-secondary)]">Mengde: <span className="font-medium">{d.quantity} {unit}</span></p>
                    {d.delta !== undefined && (
                      <p className="text-green-600 font-medium">+{d.delta} fra EM</p>
                    )}
                    <p className="text-[var(--color-text-muted)] italic leading-snug">{d.label}</p>
                    {d.reviewedBy && <p className="text-[var(--color-text-muted)]">Godkjent av: {d.reviewedBy}</p>}
                  </div>
                )
              }}
            />
            {approvedCOs.map((co) => (
              <ReferenceLine
                key={co.id}
                x={co.reviewed_at!.split('T')[0]}
                stroke={CHART_REFERENCE_LINE}
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
            ))}
            <Line
              type="stepAfter"
              dataKey="quantity"
              stroke={CHART_LINE_ACCENT}
              strokeWidth={2}
              dot={{ fill: CHART_LINE_ACCENT, r: 4 }}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {approvedCOs.length > 0 && (
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Endringsmeldinger</p>
          {approvedCOs.map((co) => (
            <div key={co.id} className="flex items-start gap-3 text-xs">
              <span className="mt-0.5 w-2 h-2 rounded-full bg-blue-500 flex-none" />
              <div className="flex-1 min-w-0">
                <span className="text-[var(--color-text-secondary)] truncate block">{co.reason}</span>
                <span className="text-[var(--color-text-muted)]">
                  {fmtDate(co.reviewed_at!.split('T')[0])}
                  {co.reviewed_by && ` · ${co.reviewed_by}`}
                </span>
              </div>
              <span className="font-semibold text-green-600 flex-none">+{co.requested_quantity} {unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
