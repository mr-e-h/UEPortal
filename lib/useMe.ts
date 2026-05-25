'use client'

import { useEffect, useState } from 'react'
import type { UserRole } from '@/types'

export interface Me {
  id: string
  email: string
  /**
   * The role currently in effect — reflects the view-as user when the
   * super-admin is impersonating. Use this for UI/routing decisions.
   */
  role: UserRole
  full_name: string
  subcontractor_id: string | null
  active: boolean
  /** The real session user — preserved regardless of impersonation. */
  real_id: string
  real_email: string
  real_role: UserRole
  real_full_name: string
  /** Whether the dropdown should render (hardcoded super-admin only). */
  can_view_as: boolean
  /** True when the top-level id ≠ real_id (i.e. impersonating someone). */
  impersonating: boolean
}

let cached: Me | null = null
let inflight: Promise<Me | null> | null = null
const subscribers = new Set<(me: Me | null) => void>()

async function fetchMe(): Promise<Me | null> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch('/api/me', { credentials: 'same-origin' })
      if (!res.ok) return null
      const data = await res.json() as Me
      cached = data
      return data
    } catch {
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * Client hook that returns the current user from the session, or null if
 * not signed in. The result is module-level cached so multiple components
 * share one /api/me round-trip per page load.
 *
 * Calls .refresh() to force a re-fetch after a role change, sign-in, etc.
 * Calls .clear() on logout.
 */
export function useMe(): { me: Me | null; loading: boolean; refresh: () => Promise<void>; clear: () => void } {
  const [me, setMe] = useState<Me | null>(cached)
  const [loading, setLoading] = useState<boolean>(cached === null)

  useEffect(() => {
    let mounted = true
    const sub = (next: Me | null) => { if (mounted) setMe(next) }
    subscribers.add(sub)

    if (cached === null) {
      fetchMe().then((next) => {
        if (mounted) {
          setMe(next)
          setLoading(false)
        }
      })
    } else {
      setLoading(false)
    }

    return () => { mounted = false; subscribers.delete(sub) }
  }, [])

  async function refresh() {
    cached = null
    const next = await fetchMe()
    setMe(next)
    subscribers.forEach((s) => s(next))
  }

  function clear() {
    cached = null
    setMe(null)
    subscribers.forEach((s) => s(null))
  }

  return { me, loading, refresh, clear }
}
