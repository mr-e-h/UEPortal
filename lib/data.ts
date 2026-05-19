import { getSupabaseAdmin } from './supabase'

/**
 * Translate a legacy JSON filename ("users.json") to the Supabase table name.
 * Keep this table-naming policy in one place so all callers stay in sync.
 */
function tableFor(filename: string): string {
  return filename.replace(/\.json$/i, '')
}

/**
 * Read every row from a table. Generic over the row type so existing
 * callers (readJson<User>('users.json')) work unchanged once awaited.
 */
async function readJson<T>(filename: string): Promise<T[]> {
  const sb = getSupabaseAdmin()
  const table = tableFor(filename)
  const { data, error } = await sb.from(table).select('*')
  if (error) throw new Error(`readJson(${filename}): ${error.message}`)
  return (data ?? []) as T[]
}

/**
 * Sync a full table to match the given array. Computes the diff against the
 * current DB state and applies inserts, updates, and deletes by id.
 *
 * Preserves the existing call pattern:
 *   const items = await readJson<T>('table.json')
 *   items.push(newItem)
 *   await writeJson('table.json', items)
 *
 * Requirements:
 *   - T must have an `id: string` (true for every table in the schema except
 *     `lump_sum_codes`, which is read-only via readJson and never written).
 *
 * Concurrency note: this is read-modify-write and is NOT safe under concurrent
 * writers. Two requests editing the same table at the same time can lose data.
 * Future work: switch endpoints to per-row Supabase calls (insert/update/delete)
 * once the test domain proves out.
 */
async function writeJson<T extends { id: string }>(
  filename: string,
  newRows: T[]
): Promise<void> {
  const sb = getSupabaseAdmin()
  const table = tableFor(filename)

  const { data: existing, error: readErr } = await sb.from(table).select('id')
  if (readErr) throw new Error(`writeJson(${filename}) read: ${readErr.message}`)

  const existingIds = new Set((existing ?? []).map((r: { id: string }) => r.id))
  const newIds = new Set(newRows.map((r) => r.id))

  const toDelete = Array.from(existingIds).filter((id) => !newIds.has(id))
  if (toDelete.length > 0) {
    const { error } = await sb.from(table).delete().in('id', toDelete)
    if (error) throw new Error(`writeJson(${filename}) delete: ${error.message}`)
  }

  if (newRows.length > 0) {
    const { error } = await sb.from(table).upsert(newRows as unknown[], { onConflict: 'id' })
    if (error) throw new Error(`writeJson(${filename}) upsert: ${error.message}`)
  }
}

async function getDeletedProjectIds(): Promise<Set<string>> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.from('projects').select('id').eq('deleted', true)
  if (error) throw new Error(`getDeletedProjectIds: ${error.message}`)
  return new Set((data ?? []).map((p: { id: string }) => p.id))
}

export { readJson, writeJson, getDeletedProjectIds }
