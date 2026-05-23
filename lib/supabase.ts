import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

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
 * Env vars are validated in lib/env.ts on first import (prod throws, dev warns).
 */

let cached: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached

  cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  return cached
}
