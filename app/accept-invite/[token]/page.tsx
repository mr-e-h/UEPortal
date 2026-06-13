'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { roleLabel } from '@/lib/roles'
import Field from '@/components/ui/Field'
import Input from '@/components/ui/Input'
import ErrorBox from '@/components/ui/ErrorBox'
import Button from '@/components/ui/Button'

type Status = 'loading' | 'valid' | 'invalid' | 'success'

interface InviteInfo {
  email: string
  role: string
}

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()

  const [status, setStatus] = useState<Status>('loading')
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    fetch(`/api/invitations/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.ok) {
          const data = (await r.json()) as InviteInfo
          setInvite(data)
          setStatus('valid')
        } else {
          const data = await r.json().catch(() => ({ error: 'Ugyldig invitasjon' }))
          setErrorMessage(data.error ?? 'Ugyldig invitasjon')
          setStatus('invalid')
        }
      })
      .catch(() => {
        setErrorMessage('Klarte ikke å sjekke invitasjonen')
        setStatus('invalid')
      })
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!invite) return

    if (password.length < 8) {
      setFormError('Passord må være minst 8 tegn')
      return
    }
    if (password !== confirm) {
      setFormError('Passordene stemmer ikke overens')
      return
    }
    if (!fullName.trim()) {
      setFormError('Navn er påkrevd')
      return
    }

    setSubmitting(true)
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: invite.email,
        password,
        full_name: fullName.trim(),
        token,
      }),
    })
    setSubmitting(false)

    if (res.ok) {
      setStatus('success')
      setTimeout(() => router.push('/login'), 1500)
    } else {
      const data = await res.json().catch(() => ({ error: 'Registrering feilet' }))
      setFormError(data.error ?? 'Registrering feilet')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-page)] px-4">
      <div className="w-full max-w-sm bg-card rounded-xl border border-border p-8 shadow-sm">
        <div className="border-t-4 border-primary -mt-8 -mx-8 mb-6 rounded-t-xl" />
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Aksepter invitasjon</h1>

        {status === 'loading' && (
          <p className="mt-6 text-sm text-[var(--color-text-muted)]">Sjekker invitasjon...</p>
        )}

        {status === 'invalid' && (
          <div className="mt-6 space-y-4">
            <ErrorBox>{errorMessage ?? 'Invitasjonen er ugyldig.'}</ErrorBox>
            <Link href="/login" className="block text-sm text-primary hover:underline">
              Til innlogging
            </Link>
          </div>
        )}

        {status === 'success' && (
          <div className="mt-6">
            <ErrorBox variant="success">
              Konto opprettet. Sender deg til innlogging...
            </ErrorBox>
          </div>
        )}

        {status === 'valid' && invite && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="text-sm bg-primary-soft text-primary border border-primary/20 rounded px-3 py-2">
              Invitert som <strong>{roleLabel(invite.role)}</strong>
            </div>

            <Field label="E-post">
              <input
                type="email"
                value={invite.email}
                readOnly
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-muted text-[var(--color-text-muted)]"
              />
            </Field>

            {formError && <ErrorBox>{formError}</ErrorBox>}

            <Field label="Fullt navn">
              <Input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
              />
            </Field>

            <Field label="Passord (minst 8 tegn)">
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>

            <Field label="Bekreft passord">
              <Input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </Field>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Oppretter...' : 'Opprett konto'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
