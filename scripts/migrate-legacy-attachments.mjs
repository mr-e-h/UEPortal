// Migrate change-order attachments from the old public/uploads/ folder
// (which only existed on local dev; Vercel serverless has read-only FS)
// to the private Supabase Storage `attachments` bucket created in migration
// `create_attachments_bucket`.
//
// Reads each change_order with an attachment_url starting with "/uploads/",
// uploads the local file to Storage with path "<co_id>/<filename>", and
// updates the row's attachment_url to the new object path.
//
// Run: node --env-file=.env.local scripts/migrate-legacy-attachments.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false } })

function guessMime(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1)
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
  }[ext] ?? 'application/octet-stream'
}

const { data: orders, error } = await sb
  .from('change_orders')
  .select('id, attachment_url')
  .like('attachment_url', '/uploads/%')

if (error) {
  console.error('query failed:', error.message)
  process.exit(1)
}

if (!orders || orders.length === 0) {
  console.log('No legacy attachments to migrate.')
  process.exit(0)
}

console.log(`Migrating ${orders.length} legacy attachment(s)...\n`)
let ok = 0
let skipped = 0
let failed = 0

for (const order of orders) {
  const legacyPath = order.attachment_url // e.g. "/uploads/123-image.png"
  const fileName = legacyPath.replace(/^\/uploads\//, '')
  const localFile = path.join(root, 'public', 'uploads', fileName)

  if (!fs.existsSync(localFile)) {
    console.log(`skip ${order.id}: file not found locally (${legacyPath})`)
    skipped++
    continue
  }

  const bytes = fs.readFileSync(localFile)
  // Strip the leading "<id>-" prefix from legacy names so the new key looks
  // like the new POST handler's format ("<co_id>/<sanitized_filename>").
  const cleanName = fileName.replace(new RegExp(`^${order.id}-`), '')
  const objectPath = `${order.id}/${cleanName}`
  const contentType = guessMime(cleanName)

  const { error: upErr } = await sb.storage
    .from('attachments')
    .upload(objectPath, bytes, { contentType, upsert: true })

  if (upErr) {
    console.error(`FAIL ${order.id}: ${upErr.message}`)
    failed++
    continue
  }

  const { error: updErr } = await sb
    .from('change_orders')
    .update({ attachment_url: objectPath })
    .eq('id', order.id)

  if (updErr) {
    console.error(`FAIL ${order.id} db update: ${updErr.message}`)
    failed++
    continue
  }

  console.log(`ok   ${order.id} → ${objectPath} (${bytes.length} bytes)`)
  ok++
}

console.log(`\nDone: ${ok} migrated, ${skipped} skipped, ${failed} failed`)
