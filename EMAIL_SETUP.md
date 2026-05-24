# MinUE — domene + e-post setup

Dette dokumentet er sjekklisten for å ta i bruk **minue.no** som domene
og **noreply@minue.no** som avsender for systemets utgående e-post
(invitasjoner, passord-reset). Stegene som krever penger eller
registrar-tilgang må gjøres av deg manuelt — koden er allerede klargjort.

---

## Sluttstatus du sikter mot

- `minue.no` er registrert i ditt navn / Netels org.nr.
- Resend kan sende e-post fra `noreply@minue.no` uten å havne i spam.
- Vercel-prosjektet bruker `EMAIL_FROM=MinUE <noreply@minue.no>`.
- `app.minue.no` (eller hva du velger) peker på Vercel-deployen.

---

## Steg 1 — kjøp domenet minue.no

Domene-registreringer for `.no` er regulert av Norid. Du må gå gjennom en
norsk registrar og være registrert med personnummer eller org.nr.

Anbefalte registrar:

| Registrar | Pris/år ca. | Lenke |
|-----------|-------------|-------|
| **Domeneshop** | ~149 kr | https://domene.shop |
| **One.com** | ~99 kr (første år) | https://www.one.com |
| **Hostnet** | ~129 kr | https://www.hostnet.no |

> **Hva jeg ikke kan gjøre:** Jeg kan ikke kjøpe domener på dine vegne —
> det krever betalingskort + ditt fødselsnummer/org.nr. Logg inn selv
> hos én av registrarene over, søk etter `minue.no`, og fullfør kjøpet.

Etter kjøp har du tilgang til en **DNS-administrasjon**-side hos
registraren. Den brukes i steg 2.

---

## Steg 2 — opprett Resend-konto og verifiser domenet

1. Logg inn på https://resend.com (eller opprett konto hvis du ikke har).
2. Klikk **Domains → Add Domain**.
3. Skriv inn `minue.no` og velg region `eu-west-1` (Irland — nærmest Norge).
4. Resend gir deg **4 DNS-records** å legge inn. Eksempel:

   | Type | Name | Value |
   |------|------|-------|
   | TXT | `send.minue.no` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey.minue.no` | `p=MIGfMA0G...` (lang DKIM-streng) |
   | MX | `send.minue.no` | `feedback-smtp.eu-west-1.amazonses.com` (priority 10) |
   | TXT | `_dmarc.minue.no` | `v=DMARC1; p=none;` |

5. Gå til registrarens DNS-side og legg inn alle 4 records nøyaktig som
   vist. Vær oppmerksom på at noen registrar krever at du dropper
   domenenavnet fra `Name`-feltet (skriv f.eks. `send` istedenfor
   `send.minue.no`).
6. Tilbake i Resend, klikk **Verify DNS Records**. Det kan ta 5–60
   minutter før DNS propagerer.
7. Når statusen viser **Verified**, er domenet klart.

---

## Steg 3 — opprett API-nøkkel

1. I Resend, gå til **API Keys → Create API Key**.
2. Navn: `minue-prod`. Permission: **Sending access**. Domain: `minue.no`.
3. Kopier nøkkelen (vises kun én gang — den begynner med `re_...`).

---

## Steg 4 — sett env-vars i Vercel

Gå til Vercel-prosjektet (`UEPortal`) → **Settings → Environment Variables**
og legg til/oppdater:

| Variable | Value | Environment |
|----------|-------|-------------|
| `RESEND_API_KEY` | `re_...` fra steg 3 | Production |
| `EMAIL_FROM` | `MinUE <noreply@minue.no>` | Production |
| `APP_BASE_URL` | `https://app.minue.no` (eller `https://minue.no`) | Production |

Etter at variablene er lagret må du **re-deploye** (Deployments → siste
deploy → ⋯ → Redeploy) for at de skal tre i kraft.

---

## Steg 5 — pek domenet på Vercel (valgfritt, men anbefalt)

Hvis du vil at portalen skal ligge på `https://app.minue.no` istedenfor
den genererte `*.vercel.app`-URLen:

1. I Vercel → **Settings → Domains**, skriv inn `app.minue.no` og klikk
   Add.
2. Vercel gir deg én CNAME-record:

   | Type | Name | Value |
   |------|------|-------|
   | CNAME | `app` | `cname.vercel-dns.com` |

3. Legg inn hos registraren (samme DNS-side som steg 2).
4. Vent på Vercel-statusen → **Valid Configuration**. SSL-sertifikatet
   utstedes automatisk.

(Hvis du vil at hoveddomenet `minue.no` skal peke på portalen, må du i
tillegg legge inn en `A`-record som peker på Vercels IP `76.76.21.21`.
Anbefalt: bruk subdomenet `app.` istedenfor for fremtidig fleksibilitet.)

---

## Steg 6 — test sending

Etter at alt over er gjort:

1. Gå til `https://app.minue.no/forgot-password`.
2. Skriv inn en e-postadresse du har tilgang til.
3. Sjekk innboksen (og spam-mappen).
4. Sjekk Resend-dashboardet under **Logs** for å se sending-statusen.

Hvis e-posten kommer fram med riktig avsender og lenken fungerer, er
oppsettet komplett.

---

## Hva koden allerede gjør

Følgende er allerede klart i kodebasen:

- `lib/email.ts` faller tilbake på `'MinUE <noreply@minue.no>'` hvis
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

**"Domain not verified"** i Resend etter 1 time:
- Sjekk DNS med `nslookup -type=TXT resend._domainkey.minue.no` (eller
  https://mxtoolbox.com/). Hvis ingen records vises, er noe galt i
  registrarens DNS-panel.

**E-post havner i spam:**
- Sjekk at SPF, DKIM og DMARC-records er korrekt satt opp.
- Send en testmelding til `mail-tester.com` for full diagnose.

**E-post sendes ikke i det hele tatt:**
- Sjekk Vercel runtime-logger (Functions → Logs → siste forespørsel mot
  `/api/auth/forgot-password`).
- Sjekk Resend-dashboardet under **Logs**.

---

## Hva jeg (Claude) ikke kunne gjøre selv

- **Kjøpe domener** — krever penger og fødselsnummer/org.nr.
- **Legge inn DNS-records** — krever tilgang til registrarens kontroll-
  panel.
- **Opprette Resend-konto eller API-nøkler** — krever passordtilgang.
- **Endre Vercel env-vars** — krever Vercel-innlogging.

Alt annet er klart. Følg sjekklisten over så er du i mål.
