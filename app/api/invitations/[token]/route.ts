import { NextRequest, NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { hashToken, safeCompareHash } from '@/lib/tokens'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import type { Invitation } from '@/types'

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  // Rate-limit token lookups so the 256-bit token space can't be brute-forced
  // by hammering this public endpoint.
  const ip = clientIp(req)
  const byIp = await rateLimit({ key: `invite-lookup:ip:${ip}`, limit: 30, windowMs: 60_000 })
  if (!byIp.ok) {
    return NextResponse.json({ error: 'For mange forsøk' }, { status: 429 })
  }

  const hashed = hashToken(params.token)
  const invitations = await readJson<Invitation>('invitations.json')
  const inv = invitations.find((i) => safeCompareHash(i.token_hash, hashed))

  if (!inv) return NextResponse.json({ error: 'Invitasjon ikke funnet' }, { status: 404 })
  if (inv.accepted_at) return NextResponse.json({ error: 'Invitasjonen er allerede brukt' }, { status: 410 })
  if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'Invitasjonen har utløpt' }, { status: 410 })

  return NextResponse.json({ email: inv.email, role: inv.role })
}
