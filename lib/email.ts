import type { EmailContent } from './email-templates'
import { env, isProd } from './env'

/**
 * Mask the path/query of any link so a logged email body can't leak the
 * single-use token inside a reset/invite URL. Keeps the origin so a dev still
 * sees which flow fired (e.g. "https://minue.app/[token-lenke skjult]").
 */
function redactTokenLinks(text: string): string {
  return text.replace(/(https?:\/\/[^/\s]+)\/\S+/g, '$1/[token-lenke skjult]')
}

/**
 * Send an email via Resend. Falls back to console logging if RESEND_API_KEY
 * is not set (dev mode without an email provider).
 */
export async function sendEmail(opts: { to: string; content: EmailContent }): Promise<void> {
  const { to, content } = opts
  // Production should always set EMAIL_FROM explicitly (e.g. "MinUE <noreply@minue.app>")
  // after the Resend domain is verified. The fallback only works for dev/test
  // because onboarding@resend.dev is Resend's shared sandbox sender — limited
  // to the API key's own owner address and not suitable for real users.
  const from = env.EMAIL_FROM ?? 'MinUE <noreply@minue.app>'

  if (!env.RESEND_API_KEY) {
    if (isProd) {
      // Refuse to silently drop emails (and especially refuse to log reset
      // tokens to Vercel runtime logs) once we're in prod.
      throw new Error('RESEND_API_KEY missing in production')
    }
    console.log('\n=== [email stub — RESEND_API_KEY not set] ===')
    console.log(`To:      ${to}`)
    console.log(`From:    ${from}`)
    console.log(`Subject: ${content.subject}`)
    console.log(`---`)
    // The body carries single-use reset/invite tokens — i.e. account-takeover
    // credentials. Printing them unmasked leaks them into any captured console
    // (CI, shared dev box, recorded terminal). Redact token links by default;
    // a local dev who needs the clickable link opts in with EMAIL_DEBUG=1.
    if (process.env.EMAIL_DEBUG === '1') {
      console.log(content.text)
    } else {
      console.log(redactTokenLinks(content.text))
      console.log('(token-lenker skjult — sett EMAIL_DEBUG=1 for å vise dem lokalt)')
    }
    console.log(`=== end of stub email ===\n`)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: content.subject,
      text: content.text,
      html: content.html,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`Resend send failed (${res.status}):`, body)
    throw new Error(`Email send failed: HTTP ${res.status}`)
  }
}

/**
 * Build an absolute URL using APP_BASE_URL, falling back to the request's
 * own origin in dev. Used to construct invitation/reset links in emails.
 */
export function buildAppUrl(path: string, requestUrl?: string): string {
  // In production refuse to fall back to request-origin: a spoofed Host header
  // would otherwise let an attacker make reset/invitation links point at evil.com.
  if (isProd && !env.APP_BASE_URL) {
    throw new Error('APP_BASE_URL must be set in production')
  }
  const base = env.APP_BASE_URL ?? (requestUrl ? new URL(requestUrl).origin : 'http://localhost:3010')
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}
