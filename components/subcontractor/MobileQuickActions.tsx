'use client'

import { useEffect, useState } from 'react'
import { Send, Plus } from 'lucide-react'
import { useMe } from '@/lib/useMe'
import ProjectPickerModal from './ProjectPickerModal'

interface PickerProject {
  id: string
  name: string
  project_number: string
  pending_em_count: number
  pending_weekly_count: number
}

/**
 * Mobile-only bottom shortcut bar shown to sub users on every sub page.
 * Mirrors the prominent dashboard CTAs but is always within thumb-reach
 * while the user is deep inside a project. Renders nothing on md+ (the
 * page-level CTAs handle that breakpoint).
 *
 * Sits ABOVE the floating hamburger button (hamburger is bottom-left,
 * these two buttons start from the right edge and grow towards the
 * hamburger).
 */
export default function MobileQuickActions() {
  const { me } = useMe()
  const [projects, setProjects] = useState<PickerProject[]>([])
  const [picker, setPicker] = useState<'new-em' | 'weekly-report' | null>(null)

  useEffect(() => {
    if (!me?.subcontractor_id) return
    // Hent kun den lette prosjektlista (samme endepunkt prosjektsidene bruker),
    // ikke hele dashboard-aggregeringen. Routen scoper UE fra sesjonen selv, så
    // ingen ?subcontractor_id-param trengs. Retur-shapen er ett element per
    // prosjekt med id/name/project_number + pending-tellerne pickeren viser.
    fetch('/api/subcontractor/projects')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PickerProject[] | null) => {
        if (Array.isArray(data)) setProjects(data)
      })
      .catch(() => {})
  }, [me?.subcontractor_id])

  // Don't render anything until we know the user is actually a sub —
  // including the view-as case where admin posing as a sub-without-sub_id
  // would otherwise see useless buttons.
  if (!me || me.role !== 'sub') return null

  return (
    <>
      <div className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border flex items-stretch shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        {/* Left spacer matches the hamburger button's footprint so the two
            action buttons don't collide with it visually. */}
        <div className="w-16 flex-none" aria-hidden="true" />
        <button
          type="button"
          onClick={() => setPicker('weekly-report')}
          disabled={!me.subcontractor_id}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={16} /> Ukesrapport
        </button>
        <button
          type="button"
          onClick={() => setPicker('new-em')}
          disabled={!me.subcontractor_id}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={16} /> Endringsmelding
        </button>
      </div>

      {picker && (
        <ProjectPickerModal
          projects={projects}
          action={picker}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  )
}
