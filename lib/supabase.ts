import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

/**
 * Server-side Supabase client using the service_role key.
 *
 * Security model — default-deny at the DB edge, authz in the app layer:
 *   - Every table has RLS ENABLED with zero policies. RLS-on + no-policy means
 *     anon/authenticated roles match no rows → they get nothing. This client
 *     uses service_role, which BYPASSES RLS, so all data access must go through
 *     it from Next.js server code (API routes / server components) only.
 *   - Authorization (who may read/write what) is enforced in the application
 *     layer via lib/api-guard.ts — NOT by RLS policies. The empty-policy RLS is
 *     a backstop, not the access-control mechanism.
 *   - Sensitive columns (customer_price_snapshot, total_customer_value, profit,
 *     margin, customer_price) are stripped per-request for UE/sub callers in the
 *     API routes; they are never exposed to anon/authenticated via the DB.
 *
 * INVARIANT for new tables: any new public table MUST have RLS enabled
 * (ALTER TABLE ... ENABLE ROW LEVEL SECURITY) so it inherits the default-deny.
 * Forgetting this leaves the table readable/writable by anon/authenticated.
 *
 * If we ever adopt Supabase Auth: swap to the anon key in the browser and add
 * real RLS policies keyed on auth.uid(), then retire this admin client.
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
