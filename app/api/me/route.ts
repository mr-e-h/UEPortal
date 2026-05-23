import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

/**
 * Returns the current session's user, or 401 if not logged in.
 * Used by the client useMe() hook to derive UI state without trusting
 * localStorage (which can be cleared independently of the auth cookie).
 *
 * Returns only the safe public fields — never the password hash.
 */
export async function GET() {
  const user = await getSession()
  if (!user) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { id, email, role, full_name, subcontractor_id, active } = user
  return NextResponse.json({ id, email, role, full_name, subcontractor_id, active })
}
