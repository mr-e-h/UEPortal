export type BadgeStatus = 'approved' | 'pending' | 'rejected' | 'active' | 'draft' | 'submitted' | 'completed' | 'archived' | 'revision_requested'

const cls: Record<BadgeStatus, string> = {
  approved: 'bg-success-soft text-success',
  pending: 'bg-warning-soft text-warning',
  submitted: 'bg-warning-soft text-warning',
  rejected: 'bg-danger-soft text-danger',
  active: 'bg-primary-soft text-primary',
  draft: 'bg-muted text-[var(--color-text-muted)]',
  completed: 'bg-success-soft text-success',
  archived: 'bg-muted text-[var(--color-text-muted)]',
  revision_requested: 'bg-orange-100 text-orange-700',
}

const label: Record<BadgeStatus, string> = {
  approved: 'Godkjent',
  pending: 'Venter',
  submitted: 'Innsendt',
  rejected: 'Avvist',
  active: 'Aktiv',
  draft: 'Kladd',
  completed: 'Fullført',
  archived: 'Arkivert',
  revision_requested: 'Trenger revisjon',
}

export default function Badge({ status }: { status: BadgeStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls[status] ?? 'bg-muted text-[var(--color-text-secondary)]'}`}>
      {label[status] ?? status}
    </span>
  )
}
