// Seed Supabase from existing data/*.json files. Idempotent: uses upsert
// on the id column, so running it multiple times is safe.
//
// Run with: node --env-file=.env.local scripts/seed-supabase.mjs
//
// Tables seeded in dependency order. Skips tables whose JSON file is missing
// or empty.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false } })

// Order matters: parents before children to satisfy FKs.
const TABLES = [
  // Reference / config
  'products',
  'subcontractors',
  'time_types',
  'forecast_periods',
  // Users + auth
  'users',
  'invitations',
  'password_resets',
  // Pricing
  'subcontractor_product_prices',
  // Projects
  'projects',
  'project_subcontractors',
  'project_budget_lines',
  'budget_versions',
  // Change orders
  'change_orders',
  // Weekly reports
  'weekly_reports',
  'weekly_report_lines',
  // Legacy
  'reports',
  'report_lines',
  // Time tracking
  'project_hour_budgets',
  'hour_entries',
  // Invoicing
  'project_invoices',
  'ue_invoices',
  'project_internal_costs',
  // Forecasts
  'project_forecasts',
  'project_forecast_months',
  'project_forecast_extras',
  'project_month_plans',
  // Aux
  'milestones',
  'activity_log',
]

function readJsonFile(filename) {
  const file = path.join(dataDir, filename)
  if (!fs.existsSync(file)) return null
  const raw = fs.readFileSync(file, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.error(`failed to parse ${filename}:`, err.message)
    return null
  }
}

function sanitize(table, row) {
  // Empty date strings break the date type. Map "" → null on known date columns.
  const dateCols = ['start_date', 'end_date']
  const out = { ...row }
  for (const col of dateCols) {
    if (out[col] === '') out[col] = null
  }
  // Some legacy projects have empty start_date — give them a placeholder so
  // the FK chain below can succeed. Real dates can be fixed in the UI.
  if (table === 'projects' && !out.start_date) out.start_date = '2026-01-01'
  return out
}

function dedupeById(rows) {
  // Later rows win on duplicate id (matches Postgres upsert semantics row-by-row).
  const map = new Map()
  for (const r of rows) map.set(r.id, r)
  return [...map.values()]
}

async function seedTable(table) {
  const raw = readJsonFile(`${table}.json`)
  if (!raw) {
    console.log(`skip ${table}: no JSON file`)
    return
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    console.log(`skip ${table}: empty`)
    return
  }
  const rows = dedupeById(raw.map((r) => sanitize(table, r)))
  const droppedDupes = raw.length - rows.length
  const { error } = await sb.from(table).upsert(rows, { onConflict: 'id' })
  if (error) {
    console.error(`FAIL ${table}: ${error.message}`)
    return
  }
  const note = droppedDupes > 0 ? ` (dropped ${droppedDupes} dup id${droppedDupes === 1 ? '' : 's'})` : ''
  console.log(`ok   ${table}: ${rows.length} rows${note}`)
}

async function seedLumpSumCodes() {
  const rows = readJsonFile('lump_sum_codes.json')
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    console.log('skip lump_sum_codes: empty')
    return
  }
  const upsert = rows.map((code) => ({ code }))
  const { error } = await sb.from('lump_sum_codes').upsert(upsert, { onConflict: 'code' })
  if (error) {
    console.error(`FAIL lump_sum_codes: ${error.message}`)
    return
  }
  console.log(`ok   lump_sum_codes: ${rows.length} rows`)
}

async function seedSpecialRows() {
  // App uses "__intern__" as a sentinel assigned_subcontractor_id on
  // internal-cost budget lines (see app/admin/projects/[id]/page.tsx).
  // Insert it as a real subcontractor so the FK in project_budget_lines
  // resolves. Marked inactive so it never shows up in real UE pickers.
  const { error } = await sb.from('subcontractors').upsert({
    id: '__intern__',
    company_name: 'Intern / Netel',
    contact_person: '',
    email: '',
    phone: '',
    organization_number: '',
    county: '',
    active: false,
  }, { onConflict: 'id' })
  if (error) console.error(`FAIL __intern__ sentinel: ${error.message}`)
  else console.log('ok   __intern__ sentinel subcontractor')
}

console.log(`seeding ${url}...\n`)
for (const table of TABLES) {
  await seedTable(table)
  // Insert the sentinel right after subcontractors so subsequent FKs resolve.
  if (table === 'subcontractors') await seedSpecialRows()
}
await seedLumpSumCodes()
console.log('\ndone')
