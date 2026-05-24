import type { EmailContent } from './email-templates'
import { env, isProd } from './env'

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
    console.log(content.text)
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
