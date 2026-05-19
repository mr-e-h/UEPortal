import { getSupabaseAdmin } from './supabase'

/**
 * Sliding-window-ish rate limit stored in Postgres. Not atomic across
 * concurrent requests at the same key (we'd need an SQL function for that),
 * but good enough to block brute-force and spam from a single source.
 *
 * @returns { ok: boolean, remaining: number, retryInMs: number }
 */
export async function rateLimit(opts: {
  key: string
  limit: number
  windowMs: number
}): Promise<{ ok: boolean; remaining: number; retryInMs: number }> {
  const { key, limit, windowMs } = opts
  const sb = getSupabaseAdmin()
  const now = Date.now()
  const newResetAt = new Date(now + windowMs).toISOString()

  const { data: existing } = await sb
    .from('rate_limits')
    .select('count, reset_at')
    .eq('key', key)
    .maybeSingle<{ count: number; reset_at: string }>()

  if (!existing || new Date(existing.reset_at).getTime() < now) {
    await sb.from('rate_limits').upsert({ key, count: 1, reset_at: newResetAt }, { onConflict: 'key' })
    return { ok: true, remaining: limit - 1, retryInMs: 0 }
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0, retryInMs: new Date(existing.reset_at).getTime() - now }
  }

  await sb.from('rate_limits').update({ count: existing.count + 1 }).eq('key', key)
  return { ok: true, remaining: limit - existing.count - 1, retryInMs: 0 }
}

/**
 * Pull a reasonable client identifier from request headers. Vercel sets
 * `x-forwarded-for` (comma-separated); we take the leftmost (client) entry.
 * Falls back to a constant if no header — that means the rate limit applies
 * globally, which is fine for fail-closed behavior.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}
