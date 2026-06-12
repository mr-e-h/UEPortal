'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Fanerad for prognoseseksjonen: Oversikt + P1–P4. Erstatter de fem
 * enkeltlenkene som tidligere lå i venstremenyen — menyen har nå ett
 * «Prognoser»-punkt (under Økonomi), og periodevalget bor her på siden.
 */
const TABS = [
  { href: '/admin/forecasts', label: 'Oversikt', exact: true },
  { href: '/admin/forecasts/p1', label: 'P1' },
  { href: '/admin/forecasts/p2', label: 'P2' },
  { href: '/admin/forecasts/p3', label: 'P3' },
  { href: '/admin/forecasts/p4', label: 'P4' },
]

export default function ForecastTabs() {
  const pathname = usePathname()
  return (
    <div className="flex items-center gap-1 border-b border-border">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-border'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
