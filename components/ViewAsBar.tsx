'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Eye, X, Search } from 'lucide-react'
import { useMe } from '@/lib/useMe'
import { roleLabel } from '@/lib/roles'
import type { UserRole } from '@/types'

interface ViewAsUser {
  id: string
  email: string
  full_name: string
  role: UserRole
  company_name: string | null
}

/**
 * Fixed top-right dropdown that lets the hardcoded super-admin pose as ANY
 * other user. Only renders when `me.can_view_as === true`. When a user is
 * chosen, the cookie is set server-side and the page is redirected to the
 * impersonated user's home so the navigation/layout matches.
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
  const [users, setUsers] = useState<ViewAsUser[]>([])
  const [search, setSearch] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  // Lazy-load the user list the first time the dropdown is opened.
  useEffect(() => {
    if (!open || users.length > 0 || !me?.can_view_as) return
    fetch('/api/admin/view-as-users')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ViewAsUser[]) => setUsers(Array.isArray(list) ? list : []))
      .catch(() => setUsers([]))
  }, [open, users.length, me?.can_view_as])

  // Close menu when clicking outside.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? users.filter((u) =>
          u.full_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.company_name?.toLowerCase().includes(q) ?? false)
        )
      : users
    const map: Record<UserRole, ViewAsUser[]> = {
      main: [], project_manager: [], company: [], sub: [],
    }
    for (const u of filtered) map[u.role].push(u)
    return map
  }, [users, search])

  if (!me || !me.can_view_as) return null

  async function impersonate(userId: string | null) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/view-as', {
        method: userId === null ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: userId === null ? undefined : JSON.stringify({ userId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? 'Kunne ikke bytte visningsmodus')
        return
      }
      await refresh()
      setOpen(false)
      setSearch('')
      // Find which role the new effective user has so we can land on the
      // right portal home. If clearing, send back to admin (the real home).
      if (userId === null) {
        router.push(ROLE_HOME[me!.real_role])
      } else {
        const target = users.find((u) => u.id === userId)
        if (target) router.push(ROLE_HOME[target.role])
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const sectionOrder: UserRole[] = ['main', 'project_manager', 'company', 'sub']

  return (
    <>
      {me.impersonating && (
        // Sticky amber banner that follows the admin everywhere while they
        // impersonate, so they can never forget what mode they're in.
        <div className="fixed inset-x-0 top-0 z-50 bg-amber-100 border-b border-amber-300 text-amber-900 text-xs font-medium py-1.5 text-center pointer-events-none">
          Viser som <strong>{me.full_name}</strong> ({roleLabel(me.role)}) — handlinger utføres fortsatt som <strong>{me.real_full_name}</strong>
        </div>
      )}

      <div ref={menuRef} className={`fixed right-4 z-[100] ${me.impersonating ? 'top-8' : 'top-3'}`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold shadow-lg border-2 transition-colors ${
            me.impersonating
              ? 'bg-amber-500 border-amber-600 text-white hover:bg-amber-600'
              : 'bg-white border-primary text-primary hover:bg-primary-soft'
          }`}
        >
          <Eye size={13} />
          <span>{me.impersonating ? `Viser: ${me.full_name}` : 'Vis som...'}</span>
          <ChevronDown size={12} />
        </button>

        {open && (
          <div className="absolute right-0 mt-1 w-80 bg-card border border-border rounded-lg shadow-lg overflow-hidden max-h-[70vh] flex flex-col">
            <div className="px-3 py-2 border-b border-border">
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                Vis appen som...
              </p>
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  autoFocus
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Søk navn, e-post, firma..."
                  className="w-full pl-7 pr-2 py-1 text-xs border border-border rounded bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {users.length === 0 ? (
                <p className="px-3 py-4 text-xs text-[var(--color-text-muted)]">Laster brukere...</p>
              ) : (
                sectionOrder.map((role) => {
                  const list = grouped[role]
                  if (list.length === 0) return null
                  return (
                    <div key={role}>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider bg-muted/40">
                        {roleLabel(role)}
                      </p>
                      {list.map((u) => {
                        const isMe = u.id === me!.real_id
                        const isActive = u.id === me!.id && me!.impersonating
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => impersonate(isMe ? null : u.id)}
                            disabled={busy}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-start justify-between gap-2 ${
                              isActive ? 'bg-primary-soft' : ''
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className={`truncate ${isActive ? 'text-primary font-semibold' : 'text-[var(--color-text-primary)] font-medium'}`}>
                                {u.full_name}
                                {isMe && <span className="ml-1.5 text-[10px] text-[var(--color-text-muted)]">(deg)</span>}
                              </p>
                              <p className="truncate text-[var(--color-text-muted)] text-[10px]">
                                {u.email}{u.company_name ? ` · ${u.company_name}` : ''}
                              </p>
                            </div>
                            {isActive && <span className="text-primary flex-none text-xs">✓</span>}
                          </button>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>

            {me.impersonating && (
              <button
                type="button"
                onClick={() => impersonate(null)}
                disabled={busy}
                className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 border-t border-border flex items-center gap-2"
              >
                <X size={12} />
                Avslutt visning-som
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
