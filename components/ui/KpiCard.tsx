export default function KpiCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide truncate text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="text-2xl font-bold mt-1.5 text-[var(--color-text-primary)]">
        {value}
      </p>
      {sub && (
        <p className="text-xs mt-1 text-[var(--color-text-muted)]">
          {sub}
        </p>
      )}
    </div>
  )
}
