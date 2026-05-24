# MinUE — domene + e-post setup

Dette dokumentet er sjekklisten for å ta i bruk **minue.app** som domene
og **noreply@minue.app** som avsender for systemets utgående e-post
(invitasjoner, passord-reset). Stegene som krever penger eller
kontotilgang må gjøres av deg manuelt — koden er allerede klargjort.

---

## Sluttstatus du sikter mot

- `minue.app` er kjøpt via Vercel og knyttet til Vercel-kontoen din.
- Resend kan sende e-post fra `noreply@minue.app` uten å havne i spam.
- Vercel-prosjektet bruker `EMAIL_FROM=MinUE <noreply@minue.app>`.
- `app.minue.app` (eller hva du velger) peker på Vercel-deployen.

---

## Steg 1 — kjøp minue.app via Vercel

1. Gå til **https://vercel.com/domains/search?q=minue.app**
2. Logg inn på Vercel hvis nødvendig
3. Klikk **Buy** på `minue.app`
4. Bekreft betaling — $9.99 USD (~110 kr) for ett år
5. Domenet vises i Vercel-kontoen din innen sekunder

> **Hva jeg ikke kan gjøre:** Jeg kan ikke klikke selve "Buy"-knappen for
> deg. Du må gjennomføre kjøpet selv.

---

## Steg 2 — koble minue.app til UEPortal-prosjektet

1. I Vercel → **UEPortal-prosjektet** → **Settings** → **Domains**
2. **Add Domain** → skriv `minue.app` → **Add**
3. Vercel viser at domenet er klart (allerede pekt riktig siden vi
   kjøpte det her — ingen DNS-konfig nødvendig)
4. SSL-sertifikat utstedes automatisk innen 1–2 minutter

Eventuelt kan du bruke `app.minue.app` istedenfor rotdomenet — da legger
du til `app.minue.app` istedenfor `minue.app` i steget over.

---

## Steg 3 — opprett Resend-domene

1. Logg inn på https://resend.com
2. Klikk **Domains → Add Domain**
3. Skriv `minue.app`, region `eu-west-1`
4. Resend gir deg **4 DNS-records** å legge inn. Eksempel:

   | Type | Name | Value |
   |------|------|-------|
   | TXT | `send.minue.app` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey.minue.app` | `p=MIGfMA0G...` (lang DKIM-streng) |
   | MX | `send.minue.app` | `feedback-smtp.eu-west-1.amazonses.com` (priority 10) |
   | TXT | `_dmarc.minue.app` | `v=DMARC1; p=none;` |

5. La fanen stå åpen — du trenger verdiene i neste steg.

---

## Steg 4 — legg DNS-records inn i Vercel

1. Tilbake i Vercel → **Settings → Domains → minue.app** → **DNS Records**
   (eller via **Storage → DNS** i sidemenyen)
2. Klikk **Add** for hver av de 4 records fra Resend
3. Pass på Name-feltet: Vercel forventer at du dropper `.minue.app`-
   suffixet, så f.eks. `send.minue.app` skrives som `send`
4. Lagre alle 4

---

## Steg 5 — verifiser i Resend

1. Gå tilbake til Resend-fanen
2. Klikk **Verify DNS Records**
3. Hvis ikke verifisert med en gang, vent 5–15 min og prøv igjen
4. Statusen skal til slutt vise **Verified**

---

## Steg 6 — opprett API-nøkkel

1. I Resend, gå til **API Keys → Create API Key**
2. Navn: `minue-prod`. Permission: **Sending access**. Domain: `minue.app`
3. Kopier nøkkelen (vises kun én gang — den begynner med `re_...`)

---

## Steg 7 — sett env-vars i Vercel

I Vercel → **UEPortal-prosjektet** → **Settings → Environment Variables**
og legg til/oppdater:

| Variable | Value | Environment |
|----------|-------|-------------|
| `RESEND_API_KEY` | `re_...` fra steg 6 | Production |
| `EMAIL_FROM` | `MinUE <noreply@minue.app>` | Production |
| `APP_BASE_URL` | `https://minue.app` (eller `https://app.minue.app`) | Production |

Etter at variablene er lagret må du **re-deploye** (Deployments → siste
deploy → ⋯ → Redeploy) for at de skal tre i kraft.

---

## Steg 8 — test sending

Etter at alt over er gjort:

1. Gå til `https://minue.app/forgot-password`
2. Skriv inn en e-postadresse du har tilgang til
3. Sjekk innboksen (og spam-mappen)
4. Sjekk Resend-dashbordet under **Logs** for å se sending-statusen

Hvis e-posten kommer fram med riktig avsender og lenken fungerer, er
oppsettet komplett.

---

## Hva koden allerede gjør

Følgende er allerede klart i kodebasen:

- `lib/email.ts` faller tilbake på `'MinUE <noreply@minue.app>'` hvis
  `EMAIL_FROM` ikke er satt.
- `lib/env.ts` dokumenterer hvilket format `EMAIL_FROM` forventer.
- `app/forgot-password/page.tsx` sender en POST til
  `/api/auth/forgot-password` som bruker `passwordResetEmail()` fra
  `lib/email-templates.ts`.
- Reset-lenken er gyldig i 1 time og kan brukes én gang.
- I produksjon kaster systemet feil hvis `RESEND_API_KEY` mangler — du
  vil aldri stille kunne miste e-poster.

---

## Feilsøking

**"Domain not verified" i Resend etter 1 time:**
- Sjekk DNS via `nslookup -type=TXT resend._domainkey.minue.app` eller
  https://mxtoolbox.com/
- Hvis ingen records vises: dobbeltsjekk Vercel DNS-panelet og at navne-
  feltet ikke har dobbel suffix

**E-post havner i spam:**
- Sjekk at SPF, DKIM og DMARC-records alle er aktive
- Send testmelding til `mail-tester.com` for full diagnose

**E-post sendes ikke i det hele tatt:**
- Sjekk Vercel runtime-logger (Functions → Logs → siste forespørsel mot
  `/api/auth/forgot-password`)
- Sjekk Resend-dashbordet under **Logs**

---

## Hva jeg (Claude) ikke kunne gjøre selv

- **Kjøpe domener** — krever betalingskort/Vercel-godkjenning
- **Logge inn på Resend/Vercel** — krever passord
- **Opprette API-nøkler** — sikkerhetssensitivt
- **Klikke "Redeploy"** etter env-var-endring

Alt annet er klart. Følg sjekklisten over så er du i mål.
