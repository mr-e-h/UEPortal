'use client'

import { useState } from 'react'
import { Send, Plus } from 'lucide-react'
import ProjectPickerModal from '@/components/subcontractor/ProjectPickerModal'

interface PickerProjectLite {
  id: string
  name: string
  project_number: string
  pending_em_count: number
  pending_weekly_count: number
}

/**
 * Client island for the dashboard's two interactive CTAs ("Send ukesrapport"
 * / "Send endringsmelding"). The surrounding dashboard is a server component;
 * only the picker-modal state needs to live on the client. Projects are passed
 * down from the RSC so this island does no fetching of its own.
 *
 * `variant` selects which button renders so the two CTAs can sit in separate
 * columns of the server-rendered grid while sharing one picker-modal instance
 * per column.
 */
export default function DashboardActions({
  projects,
  variant,
}: {
  projects: PickerProjectLite[]
  variant: 'weekly-report' | 'new-em'
}) {
  const [open, setOpen] = useState(false)

  const disabled = projects.length === 0

  return (
    <>
      {variant === 'weekly-report' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 text-base font-semibold bg-primary text-white rounded-2xl hover:bg-primary-hover transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
        >
          <Send size={20} strokeWidth={2.25} /> Send ukesrapport
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 text-base font-semibold bg-card border-2 border-primary text-primary rounded-2xl hover:bg-primary-soft transition-all shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={20} strokeWidth={2.5} /> Send endringsmelding
        </button>
      )}

      {open && (
        <ProjectPickerModal
          projects={projects}
          action={variant}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
