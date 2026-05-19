import type { EmailContent } from './email-templates'

/**
 * Send an email via Resend. Falls back to console logging if RESEND_API_KEY
 * is not set (dev mode without an email provider).
 *
 * Env vars:
 *   RESEND_API_KEY   — Resend API key (https://resend.com/api-keys)
 *   EMAIL_FROM       — verified FROM address (e.g. "Netel <no-reply@netel.no>")
 *   APP_BASE_URL     — used to build absolute links in emails (e.g. "https://portal.netel.no")
 */
export async function sendEmail(opts: { to: string; content: EmailContent }): Promise<void> {
  const { to, content } = opts
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? 'Netel UE Portal <onboarding@resend.dev>'

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
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
      Authorization: `Bearer ${apiKey}`,
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
  const fromEnv = process.env.APP_BASE_URL
  if (process.env.NODE_ENV === 'production' && !fromEnv) {
    throw new Error('APP_BASE_URL must be set in production')
  }
  const base = fromEnv ?? (requestUrl ? new URL(requestUrl).origin : 'http://localhost:3010')
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}
