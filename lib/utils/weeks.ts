export function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

/**
 * Number of ISO weeks in the given year — 52 normally, 53 in long years
 * like 2020, 2026, 2032, 2037. Returns 53 when Jan 1 or Dec 31 lands on
 * a Thursday (or for leap years where Jan 1 is a Wednesday).
 *
 * Without this, `prevWeek`/`nextWeek` and rolling-window helpers wrap
 * uke 52 → 1 / uke 1 → 52 and silently lose data for week 53.
 */
export function getISOWeeksInYear(year: number): number {
  // ISO-week trick: Dec 28 is always in the last ISO week of its year.
  return getISOWeek(new Date(year, 11, 28))
}

export function getCurrentWeek(): { year: number; week: number } {
  const now = new Date()
  return { year: now.getFullYear(), week: getISOWeek(now) }
}

/**
 * Step forward/backward one ISO week with proper year + week-53 handling.
 *
 *   nextWeek(2026, 53) → { year: 2027, week: 1 }   // 2026 has 53 weeks
 *   nextWeek(2025, 52) → { year: 2026, week: 1 }   // 2025 has 52
 *   prevWeek(2027, 1)  → { year: 2026, week: 53 }
 */
export function nextWeek(year: number, week: number): { year: number; week: number } {
  if (week >= getISOWeeksInYear(year)) return { year: year + 1, week: 1 }
  return { year, week: week + 1 }
}

export function prevWeek(year: number, week: number): { year: number; week: number } {
  if (week <= 1) {
    const prevYear = year - 1
    return { year: prevYear, week: getISOWeeksInYear(prevYear) }
  }
  return { year, week: week - 1 }
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
