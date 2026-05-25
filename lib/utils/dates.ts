/**
 * Date helpers for year/month bucketing.
 *
 * Problem: most timestamps in the DB are stored as UTC ISO strings (e.g.
 * `2026-12-31T23:30:00.000Z`). In Europe/Oslo (UTC+1 in winter, UTC+2 in
 * summer) that timestamp is `2027-01-01 00:30`. If KPIs use either:
 *   - `s.startsWith(String(year))`           → bucket by UTC year
 *   - `new Date(s).getFullYear()`            → bucket by SERVER local year
 *
 * ...we get inconsistent results across endpoints and quietly drop data at
 * the year boundary. Always use these helpers when bucketing timestamps by
 * year/month/day for Norwegian reporting.
 */

const OSLO_TZ = 'Europe/Oslo'

// Intl.DateTimeFormat is cached internally per options, so allocating here
// once per format we need is fine and the hot-path call is fast.
const YEAR_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: OSLO_TZ, year: 'numeric' })
const YEAR_MONTH_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: OSLO_TZ, year: 'numeric', month: '2-digit' })
const ISO_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: OSLO_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/**
 * Year of a timestamp as observed in Europe/Oslo time.
 * Accepts an ISO string (DB convention), Date, or undefined/null (returns null).
 */
export function osloYear(input: string | Date | null | undefined): number | null {
  if (!input) return null
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return null
  return parseInt(YEAR_FMT.format(d), 10)
}

/** "YYYY-MM" bucket for monthly KPIs, in Oslo time. */
export function osloYearMonth(input: string | Date | null | undefined): string | null {
  if (!input) return null
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return null
  // en-CA gives YYYY-MM
  return YEAR_MONTH_FMT.format(d)
}

/** "YYYY-MM-DD" calendar date in Oslo. */
export function osloDate(input: string | Date | null | undefined): string | null {
  if (!input) return null
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return null
  return ISO_DATE_FMT.format(d)
}

/**
 * Pre-parsed Oslo year for date-only strings ("2026-05-25"). These are
 * timezone-agnostic in the DB (no time component), so we read the year
 * straight from the string instead of round-tripping through Date which
 * would interpret it as UTC midnight and possibly shift.
 */
export function yearOfDateString(s: string | null | undefined): number | null {
  if (!s) return null
  const m = /^(\d{4})/.exec(s)
  return m ? parseInt(m[1], 10) : null
}

/** True if a date-string or timestamp falls inside the given Oslo year. */
export function isInOsloYear(input: string | Date | null | undefined, year: number): boolean {
  if (!input) return false
  // Date-only strings: cheap path, no Intl.
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return yearOfDateString(input) === year
  }
  return osloYear(input) === year
}
