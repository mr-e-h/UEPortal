import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getEffectiveUser, getViewAsRole, isSuperAdmin } from '@/lib/view-as'

/**
 * Returns the current session's user, or 401 if not logged in.
 * Used by the client useMe() hook to derive UI state without trusting
 * localStorage (which can be cleared independently of the auth cookie).
 *
 * The `role` field reflects the view-as override when the super-admin has
 * one active — that's intentional, the entire UI uses this as the source
 * of truth for what role the current "session" sees. The original role
 * and super-admin flag are also returned so the view-as bar can render
 * correctly and the client can tell what's going on.
 *
 * Never returns the password hash.
 */
export async function GET() {
  const realUser = await getSession()
  if (!realUser) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const effective = await getEffectiveUser(realUser)
  const viewAs = await getViewAsRole()
  return NextResponse.json({
    id: effective.id,
    email: effective.email,
    role: effective.role,
    full_name: effective.full_name,
    subcontractor_id: effective.subcontractor_id,
    active: effective.active,
    // Extra metadata for the view-as switcher. `real_role` lets the client
    // distinguish "I am Martin, currently posing as a sub" from "I am a
    // genuine sub". `can_view_as` controls whether the dropdown renders.
    real_role: realUser.role,
    can_view_as: isSuperAdmin(realUser),
    view_as: viewAs,
  })
}
