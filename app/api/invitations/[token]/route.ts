import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { hashToken, safeCompareHash } from '@/lib/tokens'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import type { Invitation } from '@/types'

/**
 * Read the invitation pointed to by a raw token. Used by the accept-invite
 * landing page to display the prefilled email + role before the user sets
 * a password.
 */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const ip = clientIp(req)
  const byIp = await rateLimit({ key: `invite-lookup:ip:${ip}`, limit: 30, windowMs: 60_000 })
  if (!byIp.ok) {
    return NextResponse.json({ error: 'For mange forsøk' }, { status: 429 })
  }

  // Lookup by token_hash directly — token is the cryptographic key.
  // safeCompareHash is still called on the returned row for defense-in-depth.
  const hashed = hashToken(params.token)
  const { data: inv } = await getSupabaseAdmin()
    .from('invitations')
    .select('*')
    .eq('token_hash', hashed)
    .maybeSingle<Invitation>()

  if (!inv || !safeCompareHash(inv.token_hash, hashed)) {
    return NextResponse.json({ error: 'Invitasjon ikke funnet' }, { status: 404 })
  }
  if (inv.accepted_at) return NextResponse.json({ error: 'Invitasjonen er allerede brukt' }, { status: 410 })
  if (new Date(inv.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Invitasjonen har utløpt' }, { status: 410 })
  }

  return NextResponse.json({ email: inv.email, role: inv.role })
}
