/**
 * Single source of truth for environment variables. Server-side only —
 * never import this from a 'use client' file.
 *
 * Required vars throw the moment the module is first imported in production,
 * stopping the function early instead of letting a downstream caller fail
 * with a confusing "undefined" mid-request.
 *
 * Optional vars return null when missing so callers can branch on presence.
 */

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    // In dev, log a loud warning but allow tests/scripts that import this
    // module without the full set of env vars to keep running. In prod,
    // refuse to start — a missing key is always a bug.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required env var: ${name}`)
    }
    console.warn(`[env] missing ${name} — set it in .env.local`)
    return ''
  }
  return v
}

function optional(name: string): string | null {
  const v = process.env[name]
  return v && v.length > 0 ? v : null
}

export const env = {
  /** Public Supabase URL — also exposed to the browser by Next.js for storage links. */
  SUPABASE_URL: required('SUPABASE_URL'),
  /** Service-role key. NEVER expose to the browser. */
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
  /** Public origin of the deployed app, used to build invitation/reset links. */
  APP_BASE_URL: optional('APP_BASE_URL'),
  /** Resend API key for outbound mail. When null, mail is logged to console (dev only). */
  RESEND_API_KEY: optional('RESEND_API_KEY'),
  /** Verified FROM address for Resend. */
  EMAIL_FROM: optional('EMAIL_FROM'),
  /** Standard Node env. */
  NODE_ENV: (process.env.NODE_ENV ?? 'development') as 'development' | 'production' | 'test',
} as const

export const isProd = env.NODE_ENV === 'production'
