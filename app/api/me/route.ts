import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getEffectiveUser, isSuperAdmin } from '@/lib/view-as'

/**
 * Returns the current session's user, or 401 if not logged in.
 * Used by the client useMe() hook to derive UI state without trusting
 * localStorage (which can be cleared independently of the auth cookie).
 *
 * When the super-admin has impersonation active, the top-level fields
 * (id, email, role, full_name, subcontractor_id) reflect the IMPERSONATED
 * user — the whole UI thinks it's that person. The `real_*` fields
 * preserve the actual session so the view-as bar can show "who am I
 * really" and so writes (which still hit the real session via
 * getSession()) can be reasoned about by client code.
 *
 * Never returns the password hash.
 */
export async function GET() {
  const realUser = await getSession()
  if (!realUser) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const effective = await getEffectiveUser(realUser)
  const impersonating = effective.id !== realUser.id

  return NextResponse.json({
    id: effective.id,
    email: effective.email,
    role: effective.role,
    full_name: effective.full_name,
    subcontractor_id: effective.subcontractor_id,
    active: effective.active,
    // Real-session metadata so the view-as bar can render and the client
    // can distinguish "I'm being someone else" from "I'm me".
    real_id: realUser.id,
    real_email: realUser.email,
    real_role: realUser.role,
    real_full_name: realUser.full_name,
    can_view_as: isSuperAdmin(realUser),
    impersonating,
  })
}
