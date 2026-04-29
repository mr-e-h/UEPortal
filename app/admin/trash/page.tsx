'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { Project } from '@/types'

export default function TrashPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await fetch('/api/projects/trash').then((r) => r.json()) as Project[]
    setProjects(data.sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? '')))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function restore(id: string) {
    setRestoring(id)
    await fetch(`/api/projects/${id}/restore`, { method: 'POST' })
    await load()
    setRestoring(null)
  }

  return (
    <main className="px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin" className="text-gray-400 hover:text-gray-600 text-sm">← Admin</Link>
        <h1 className="text-xl font-bold text-gray-900">Papirkurv</h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-500">Laster...</div>
      ) : projects.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-10 text-center text-gray-400">Papirkurven er tom</div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Prosjektnavn</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Nummer</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Kunde</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Slettet dato</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-gray-100">
                  <td className="px-3 py-2 text-gray-900">{p.name}</td>
                  <td className="px-3 py-2 text-gray-500">{p.project_number}</td>
                  <td className="px-3 py-2 text-gray-500">{p.customer}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {p.deleted_at ? new Date(p.deleted_at).toLocaleDateString('nb-NO') : '–'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => restore(p.id)}
                      disabled={restoring === p.id}
                      className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {restoring === p.id ? 'Gjenoppretter...' : 'Gjenopprett'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
