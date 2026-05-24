export interface EmailContent {
  subject: string
  text: string
  html: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function baseHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="nb">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 32px auto; padding: 0 16px; color: #0F172A;">
  <div style="border-top: 4px solid #E30613; padding-top: 24px;">
    <h1 style="font-size: 18px; font-weight: 600; margin: 0 0 16px;">${escapeHtml(title)}</h1>
    ${body}
    <p style="font-size: 12px; color: #94A3B8; margin-top: 32px; border-top: 1px solid #E5E7EB; padding-top: 16px;">
      MinUE &middot; Denne e-posten ble sendt automatisk &mdash; ikke svar på den.
    </p>
  </div>
</body>
</html>`
}

export function invitationEmail(opts: {
  acceptUrl: string
  role: string
  invitedBy?: string
}): EmailContent {
  const { acceptUrl, role, invitedBy } = opts
  const text = `Du har blitt invitert til MinUE${invitedBy ? ` av ${invitedBy}` : ''}.

Rolle: ${role}

Trykk på lenken under for å sette passord og opprette kontoen din. Lenken er gyldig i 7 dager og kan brukes én gang.

${acceptUrl}

Hvis du ikke forventet denne invitasjonen kan du ignorere e-posten.`

  const html = baseHtml(
    'Velkommen til MinUE',
    `<p style="font-size: 14px; line-height: 1.5;">Du har blitt invitert${invitedBy ? ` av <strong>${escapeHtml(invitedBy)}</strong>` : ''}.</p>
    <p style="font-size: 14px; line-height: 1.5;">Rolle: <strong>${escapeHtml(role)}</strong></p>
    <p style="font-size: 14px; line-height: 1.5;">Trykk på knappen under for å sette passord og opprette kontoen din. Lenken er gyldig i 7 dager.</p>
    <p style="margin: 24px 0;">
      <a href="${escapeHtml(acceptUrl)}" style="display: inline-block; background: #E30613; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px;">Aksepter invitasjon</a>
    </p>
    <p style="font-size: 12px; color: #64748B; word-break: break-all;">Eller kopier denne lenken: ${escapeHtml(acceptUrl)}</p>`
  )

  return { subject: 'Du har fått en invitasjon til MinUE', text, html }
}

export function passwordResetEmail(opts: { resetUrl: string }): EmailContent {
  const { resetUrl } = opts
  const text = `Det er bedt om å tilbakestille passordet til kontoen din i MinUE.

Trykk på lenken under for å velge nytt passord. Lenken er gyldig i 1 time og kan brukes én gang.

${resetUrl}

Hvis du ikke ba om dette, kan du ignorere e-posten. Passordet ditt forblir uendret.`

  const html = baseHtml(
    'Tilbakestill passord',
    `<p style="font-size: 14px; line-height: 1.5;">Det er bedt om å tilbakestille passordet til kontoen din.</p>
    <p style="font-size: 14px; line-height: 1.5;">Trykk på knappen under for å velge nytt passord. Lenken er gyldig i <strong>1 time</strong>.</p>
    <p style="margin: 24px 0;">
      <a href="${escapeHtml(resetUrl)}" style="display: inline-block; background: #E30613; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px;">Velg nytt passord</a>
    </p>
    <p style="font-size: 12px; color: #64748B; word-break: break-all;">Eller kopier denne lenken: ${escapeHtml(resetUrl)}</p>
    <p style="font-size: 13px; color: #64748B; margin-top: 24px;">Hvis du ikke ba om dette, kan du ignorere e-posten. Passordet ditt forblir uendret.</p>`
  )

  return { subject: 'Tilbakestill passord — MinUE', text, html }
}
