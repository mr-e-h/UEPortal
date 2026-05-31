'use client'

import { useRouter } from 'next/navigation'
import { useMe } from '@/lib/useMe'

/**
 * Logout control shared by all three portal shells. Kept as a tiny client
 * island so the surrounding server-rendered header/sidebar don't need to be
 * client components.
 *
 * Tears down the session server-side, resets the module-level useMe cache (so
 * the global ViewAsBar stops showing a stale user), clears localStorage
 * (transitional — some older pages still read user_id/role/name from it) and
 * sends the user to /login.
 */
export default function LogoutButton({ className }: { className?: string }) {
  const router = useRouter()
  const { clear } = useMe()

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    clear()
    localStorage.clear()
    router.push('/login')
  }

  return (
    <button
      onClick={handleLogout}
      className={className ?? 'text-xs text-[var(--color-text-muted)] hover:text-danger transition-colors'}
    >
      Logg ut
    </button>
  )
}
