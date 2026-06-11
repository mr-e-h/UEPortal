'use client'

import { useRouter } from 'next/navigation'
import Badge from '@/components/ui/Badge'
import type { Project } from '@/types'

interface Props {
  projects: Project[]
  blCounts: Record<string, number>
  subCounts: Record<string, number>
}

function fmtDate(d: string | null): string {
  if (!d) return '–'
  const [y, m, day] = d.split('-')
  return `${day}.${m}.${y.slice(2)}`
}

export default function ProjectsListTable({ projects, blCounts, subCounts }: Props) {
  const router = useRouter()

  if (projects.length === 0) {
    return <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Ingen prosjekter</div>
  }

  // Only show the Fylke (county) column when at least one project actually has
  // a value — otherwise it's just an empty column eating horizontal space.
  const showCounty = projects.some((p) => p.county)
  const headers = ['Navn', 'Nr.', 'Kunde', ...(showCounty ? ['Fylke'] : []), 'UE', 'Linjer', 'Oppstart', 'Status']

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr
              key={p.id}
              onClick={() => router.push(`/admin/projects/${p.id}`)}
              className="border-b border-border last:border-0 hover:bg-muted transition-colors cursor-pointer"
            >
              <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">{p.name}</td>
              <td className="px-4 py-2.5 text-[var(--color-text-secondary)] whitespace-nowrap">{p.project_number}</td>
              <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{p.customer}</td>
              {showCounty && <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{p.county}</td>}
              <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{subCounts[p.id] ?? 0}</td>
              <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{blCounts[p.id] ?? 0}</td>
              <td className="px-4 py-2.5 text-[var(--color-text-muted)] whitespace-nowrap">{fmtDate(p.start_date)}</td>
              <td className="px-4 py-2.5">
                {/* ProjectStatus-verdiene er gyldige BadgeStatus-verdier — direkte
                    mapping gir riktig «Fullført»/«Arkivert» (før: alt ≠ active = «Kladd»). */}
                <Badge status={p.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
