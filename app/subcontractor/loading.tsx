export default function Loading() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-6 w-48 bg-muted rounded" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 bg-card border border-border rounded-xl" />
        ))}
      </div>
      <div className="h-72 bg-card border border-border rounded-xl" />
    </div>
  )
}
