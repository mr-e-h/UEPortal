import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getEffectiveUser } from '@/lib/view-as'
import { randomUUID } from 'crypto'
import type { ActivityEntry, User } from '@/types'

/**
 * Resolve the subcontractor the current request acts as, honoring view-as.
 *
 * Returns the effective user's subcontractor_id when that user is a sub —
 * which covers BOTH a real signed-in UE and the super-admin "viewing as" a
 * UE (getEffectiveUser swaps in the impersonated row). Returns null for
 * anyone who isn't effectively a sub (e.g. a real admin not impersonating).
 *
 * This mirrors how the subcontractor portal pages already resolve their data
 * via the effective user, so the tender UE endpoints behave identically under
 * view-as as the rest of the UE portal.
 */
export async function resolveEffectiveSub(): Promise<{ user: User; subId: string } | null> {
  const real = await getSession()
  if (!real) return null
  const eff = await getEffectiveUser(real)
  if (eff.role !== 'sub' || !eff.subcontractor_id) return null
  return { user: eff, subId: eff.subcontractor_id }
}

/**
 * Append an audit row for a tender event. Mirrors the change-order
 * logActivity helper — a direct insert so concurrent calls compose safely.
 */
export async function logTenderActivity(
  tenderId: string,
  action: ActivityEntry['action'],
  actor: string,
  comment?: string,
): Promise<void> {
  await getSupabaseAdmin().from('activity_log').insert({
    id: randomUUID(),
    entity_type: 'tender',
    entity_id: tenderId,
    action,
    actor,
    comment,
    created_at: new Date().toISOString(),
  })
}

/**
 * A tender's deadline has passed when deadline_at is set and in the past.
 * Used to lock UE bid editing and to surface "Frist utløpt" without needing a
 * background job — we evaluate it lazily on each read/write.
 */
export function isTenderExpired(deadlineAt: string | null): boolean {
  if (!deadlineAt) return false
  return new Date(deadlineAt).getTime() < Date.now()
}
