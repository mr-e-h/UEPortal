'use client'

import { useRouter } from 'next/navigation'
import Badge from '@/components/ui/Badge'
import type { Project } from '@/types'

interface Props {
  projects: Project[]
  blCounts: Record<string, number>
  subCounts: Record<string, number>
}

export default function ProjectsListTable({ projects, blCounts, subCounts }: Props) {
  const router = useRouter()

  if (projects.length === 0) {
    return <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Ingen prosjekter</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Navn', 'Nr.', 'Kunde', 'Fylke', 'UE', 'Budsjettlinjer', 'Oppstart', 'Status'].map((h) => (
              <th
                key={h}
                className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide"
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
              <td className="px-6 py-3 font-medium text-[var(--color-text-primary)]">{p.name}</td>
              <td className="px-6 py-3 text-[var(--color-text-secondary)]">{p.project_number}</td>
              <td className="px-6 py-3 text-[var(--color-text-secondary)]">{p.customer}</td>
              <td className="px-6 py-3 text-[var(--color-text-secondary)]">{p.county}</td>
              <td className="px-6 py-3 text-[var(--color-text-muted)]">{subCounts[p.id] ?? 0}</td>
              <td className="px-6 py-3 text-[var(--color-text-muted)]">{blCounts[p.id] ?? 0}</td>
              <td className="px-6 py-3 text-[var(--color-text-muted)]">{p.start_date ?? '–'}</td>
              <td className="px-6 py-3">
                <Badge status={p.status === 'active' ? 'active' : 'draft'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
