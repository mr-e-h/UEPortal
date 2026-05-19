import { NextRequest, NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { hashToken, safeCompareHash } from '@/lib/tokens'
import type { Invitation } from '@/types'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const hashed = hashToken(params.token)
  const invitations = readJson<Invitation>('invitations.json')
  const inv = invitations.find((i) => safeCompareHash(i.token_hash, hashed))

  if (!inv) return NextResponse.json({ error: 'Invitasjon ikke funnet' }, { status: 404 })
  if (inv.accepted_at) return NextResponse.json({ error: 'Invitasjonen er allerede brukt' }, { status: 410 })
  if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'Invitasjonen har utløpt' }, { status: 410 })

  return NextResponse.json({ email: inv.email, role: inv.role })
}
