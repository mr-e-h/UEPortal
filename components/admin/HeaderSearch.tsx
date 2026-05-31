'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Admin top-bar search box. Small client island — submitting routes to the
 * search results page. Lives in the otherwise server-rendered admin header.
 */
export default function HeaderSearch() {
  const router = useRouter()
  const [search, setSearch] = useState('')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (search.trim()) {
          router.push(`/admin/search?q=${encodeURIComponent(search.trim())}`)
        }
      }}
    >
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Søk i prosjekter, UE, rapporter..."
        className="w-full max-w-[18rem] px-3 py-1.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
      />
    </form>
  )
}
