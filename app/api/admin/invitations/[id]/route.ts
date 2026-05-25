import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'

/**
 * Revoke (delete) a pending invitation by id. Admin-only.
 *
 * Mounted under /api/admin/invitations to avoid a Next.js route conflict
 * with /api/invitations/[token] (Next requires consistent slug names at
 * the same path depth — `[id]` and `[token]` can't coexist).
 *
 * Hard-deletes the row so the token cannot be used even if the recipient still
 * has the email link cached. Accepted invitations can also be deleted (cleans
 * up history), but the resulting user account is not touched.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { error, count } = await getSupabaseAdmin()
    .from('invitations')
    .delete({ count: 'exact' })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: 'Sletting feilet' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
