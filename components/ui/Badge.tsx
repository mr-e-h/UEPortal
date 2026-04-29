export type BadgeStatus = 'approved' | 'pending' | 'rejected' | 'active' | 'draft' | 'submitted' | 'completed' | 'archived'

const cls: Record<BadgeStatus, string> = {
  approved: 'bg-success-soft text-success',
  pending: 'bg-warning-soft text-warning',
  submitted: 'bg-warning-soft text-warning',
  rejected: 'bg-danger-soft text-danger',
  active: 'bg-[#FEE2E4] text-[#E30613]',
  draft: 'bg-muted text-[var(--color-text-muted)]',
  completed: 'bg-success-soft text-success',
  archived: 'bg-muted text-[var(--color-text-muted)]',
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
}

export default function Badge({ status }: { status: BadgeStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {label[status] ?? status}
    </span>
  )
}
