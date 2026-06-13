'use client'

type Props = {
  title: string
  message?: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ title, message, confirmLabel = 'Slett', onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl">
        <h2 className="font-semibold text-[var(--color-text-primary)] mb-2">{title}</h2>
        {message && <p className="text-sm text-[var(--color-text-secondary)] mb-4">{message}</p>}
        <div className="flex gap-2 justify-end mt-4">
          <button
            onClick={onCancel}
            className="text-sm px-3 py-1.5 border border-border rounded hover:bg-muted"
          >
            Avbryt
          </button>
          <button
            onClick={onConfirm}
            className="text-sm px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
