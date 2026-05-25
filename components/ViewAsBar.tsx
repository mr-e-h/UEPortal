'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Eye, X } from 'lucide-react'
import { useMe } from '@/lib/useMe'
import { ROLES } from '@/lib/roles'
import type { UserRole } from '@/types'

/**
 * Fixed top-right dropdown that lets the hardcoded super-admin pose as any
 * role. Only renders when `me.can_view_as === true`. When a role is chosen,
 * the cookie is set server-side and the page is redirected to that role's
 * default landing area so the navigation/layout matches.
 */

const ROLE_HOME: Record<UserRole, string> = {
  main: '/admin',
  project_manager: '/admin',
  company: '/company',
  sub: '/subcontractor',
}

export default function ViewAsBar() {
  const router = useRouter()
  const { me, refresh } = useMe()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the menu when clicking outside.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  if (!me || !me.can_view_as) return null

  async function switchTo(role: UserRole | null) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/view-as', {
        method: role === null ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: role === null ? undefined : JSON.stringify({ role }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? 'Kunne ikke bytte visningsmodus')
        return
      }
      await refresh()
      setOpen(false)
      // Navigate to the role's home so the layout/sidebar match the new role.
      const target = role ? ROLE_HOME[role] : ROLE_HOME[me!.real_role]
      router.push(target)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const viewing = me.view_as
  const current = ROLES.find((r) => r.value === (viewing ?? me.real_role))

  return (
    <div ref={menuRef} className="fixed top-3 right-4 z-[60]">
      {viewing && (
        // Soft banner badge along the top so the admin can never forget they're
        // in view-as mode. Pure presentation — the cookie is the source of truth.
        <div className="fixed inset-x-0 top-0 z-50 bg-amber-100 border-b border-amber-300 text-amber-900 text-xs font-medium py-1.5 text-center pointer-events-none">
          Viser som <strong>{current?.label}</strong> — handlinger utføres fortsatt som <strong>{ROLES.find((r) => r.value === me.real_role)?.label ?? me.real_role}</strong>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium shadow-md border transition-colors ${
          viewing
            ? 'bg-amber-500 border-amber-600 text-white hover:bg-amber-600'
            : 'bg-card border-border text-[var(--color-text-primary)] hover:bg-muted'
        }`}
      >
        <Eye size={13} />
        <span>{viewing ? `Viser: ${current?.label}` : 'Vis som...'}</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="px-3 py-2 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider border-b border-border">
            Bytt visningsmodus
          </div>
          <ul>
            {ROLES.map((r) => {
              const isActive = (viewing ?? me.real_role) === r.value
              const isRealRole = r.value === me.real_role
              return (
                <li key={r.value}>
                  <button
                    type="button"
                    onClick={() => switchTo(isRealRole ? null : r.value)}
                    disabled={busy}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-muted ${
                      isActive ? 'bg-primary-soft text-primary font-medium' : 'text-[var(--color-text-primary)]'
                    }`}
                  >
                    <span>
                      {r.label}
                      {isRealRole && <span className="ml-1.5 text-[10px] text-[var(--color-text-muted)]">(din rolle)</span>}
                    </span>
                    {isActive && <span className="text-xs">✓</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          {viewing && (
            <button
              type="button"
              onClick={() => switchTo(null)}
              disabled={busy}
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 border-t border-border flex items-center gap-2"
            >
              <X size={13} />
              Avslutt visning-som
            </button>
          )}
        </div>
      )}
    </div>
  )
}
