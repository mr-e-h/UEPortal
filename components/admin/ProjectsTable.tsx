'use client'

import { useRouter } from 'next/navigation'
import Badge from '@/components/ui/Badge'
import type { Project } from '@/types'

export default function ProjectsTable({ projects }: { projects: Project[] }) {
  const router = useRouter()
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          {['Prosjektnavn', 'Nummer', 'Kunde', 'Fylke', 'Status'].map((h) => (
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
            <td className="px-6 py-3">
              <Badge status={p.status === 'active' ? 'active' : 'draft'} />
            </td>
          </tr>
        ))}
        {projects.length === 0 && (
          <tr>
            <td colSpan={5} className="px-6 py-10 text-center text-sm text-[var(--color-text-muted)]">
              Ingen prosjekter ennå
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
