export function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

export function getCurrentWeek(): { year: number; week: number } {
  const now = new Date()
  return { year: now.getFullYear(), week: getISOWeek(now) }
}

export function getWeekDateRange(year: number, week: number): { start: Date; end: Date } {
  const jan4 = new Date(year, 0, 4)
  const startOfWeek1 = new Date(jan4)
  startOfWeek1.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1)
  const start = new Date(startOfWeek1)
  start.setDate(start.getDate() + (week - 1) * 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { start, end }
}

export function formatWeekLabel(year: number, week: number): string {
  const { start, end } = getWeekDateRange(year, week)
  const fmt = (d: Date) => d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })
  return `Uke ${week} (${fmt(start)} – ${fmt(end)})`
}
