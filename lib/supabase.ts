import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side Supabase client using the service_role key.
 *
 * RLS is enabled on every table with no policies — anon/authenticated roles
 * get nothing. The service_role bypasses RLS, so all data access must go
 * through this client from Next.js server code (API routes, server components).
 *
 * Authorization is enforced at the application layer (lib/api-guard.ts),
 * not the database. When we move to Supabase Auth, swap to anon key in
 * browser + RLS policies based on auth.uid().
 *
 * Required env vars (set in .env.local and Vercel):
 *   SUPABASE_URL                — https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — service_role key from Supabase API settings
 */

let cached: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Supabase env vars missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
    )
  }

  cached = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  return cached
}
