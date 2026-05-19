import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ATTACHMENTS_BUCKET } from '@/lib/storage'

// Tables to wipe completely. Order: children before parents to be polite to
// FKs (most have CASCADE, but explicit order means fewer surprises if a
// constraint is added later).
const WIPE_TABLES = [
  // Activity / audit
  'activity_log',
  // Reports
  'weekly_report_lines',
  'weekly_reports',
  'report_lines',
  'reports',
  // Change orders (depends on projects, products, subs)
  'change_orders',
  // Time tracking
  'hour_entries',
  'project_hour_budgets',
  // Invoicing
  'project_invoices',
  'ue_invoices',
  'project_internal_costs',
  // Forecasts
  'project_forecast_months',
  'project_forecast_extras',
  'project_forecasts',
  'project_month_plans',
  // Milestones
  'milestones',
  // Budget
  'project_budget_lines',
  'budget_versions',
  // Project membership / projects
  'project_subcontractors',
  'projects',
  // Subcontractor data
  'subcontractor_product_prices',
  'subcontractors',
  // Reference (user picked "alt unntatt admin")
  'products',
  'time_types',
  'forecast_periods',
  'lump_sum_codes',
  // Auth-adjacent
  'invitations',
  'password_resets',
  'rate_limits',
] as const

const REQUIRED_CONFIRMATION = 'RESET-SYSTEM'

export async function POST(request: NextRequest) {
  const session = await getSession()
  // Main only — even project_manager (admin role) can't trigger this.
  if (!session || session.role !== 'main') {
    return NextResponse.json({ error: 'Bare hovedadmin kan nullstille systemet' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  if (body?.confirmation !== REQUIRED_CONFIRMATION) {
    return NextResponse.json({ error: 'Mangler bekreftelse' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()

  // 1. Wipe table contents. Supabase-js requires a filter clause to prevent
  //    accidental full deletes — `.neq('id', '___never___')` matches every row.
  for (const table of WIPE_TABLES) {
    const idCol = table === 'lump_sum_codes' ? 'code' : 'id'
    const { error } = await sb.from(table).delete().neq(idCol, '___never___')
    if (error) {
      return NextResponse.json({ error: `Failed wiping ${table}: ${error.message}` }, { status: 500 })
    }
  }

  // 2. Users: keep only the current admin.
  {
    const { error } = await sb.from('users').delete().neq('id', session.id)
    if (error) {
      return NextResponse.json({ error: `Failed wiping users: ${error.message}` }, { status: 500 })
    }
  }

  // 3. Sessions: keep only the caller's current session (rate-limit table
  //    already wiped above; we don't want to log the calling admin out).
  {
    const { error } = await sb.from('sessions').delete().neq('user_id', session.id)
    if (error) {
      return NextResponse.json({ error: `Failed wiping sessions: ${error.message}` }, { status: 500 })
    }
  }

  // 4. Storage: empty the attachments bucket.
  try {
    // List handles pagination internally up to 100 items; loop until empty.
    while (true) {
      const { data: files, error: listErr } = await sb.storage.from(ATTACHMENTS_BUCKET).list('', { limit: 100 })
      if (listErr) throw new Error(listErr.message)
      if (!files || files.length === 0) break
      // The list returns directory entries at the prefix; we need to recurse
      // into each EM-id folder.
      const allObjects: string[] = []
      for (const entry of files) {
        if (entry.id === null) {
          // Folder entry — list its contents.
          const { data: nested } = await sb.storage.from(ATTACHMENTS_BUCKET).list(entry.name, { limit: 1000 })
          if (nested) {
            for (const f of nested) allObjects.push(`${entry.name}/${f.name}`)
          }
        } else {
          allObjects.push(entry.name)
        }
      }
      if (allObjects.length === 0) break
      const { error: removeErr } = await sb.storage.from(ATTACHMENTS_BUCKET).remove(allObjects)
      if (removeErr) throw new Error(removeErr.message)
      if (allObjects.length < 100) break
    }
  } catch (err) {
    console.error('attachment wipe:', err)
    // Don't fail the whole reset on storage cleanup; the DB part is done.
  }

  return NextResponse.json({ ok: true })
}
