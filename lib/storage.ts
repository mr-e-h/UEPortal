import { getSupabaseAdmin } from './supabase'

/**
 * Two private Storage buckets, both auth-gated through the API layer:
 *   - `attachments`     — change-order vedlegg (images + PDFs from UE)
 *   - `budget-files`    — uploaded Excel files behind every budget version
 *
 * Neither is publicly readable; downloads go through API routes that mint
 * short-lived signed URLs (or proxy bytes).
 */
export const ATTACHMENTS_BUCKET = 'attachments'
export const BUDGET_FILES_BUCKET = 'budget-files'

async function uploadTo(bucket: string, opts: { path: string; bytes: Buffer; contentType: string }) {
  const sb = getSupabaseAdmin()
  const { error } = await sb.storage.from(bucket).upload(opts.path, opts.bytes, {
    contentType: opts.contentType,
    upsert: true,
  })
  if (error) throw new Error(`storage upload failed: ${error.message}`)
}

async function signedUrlFrom(bucket: string, path: string, ttlSeconds: number) {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, ttlSeconds)
  if (error || !data) throw new Error(`signed url failed: ${error?.message ?? 'unknown'}`)
  return data.signedUrl
}

async function downloadFrom(bucket: string, path: string) {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.storage.from(bucket).download(path)
  if (error || !data) throw new Error(`download failed: ${error?.message ?? 'unknown'}`)
  const ab = await data.arrayBuffer()
  return { bytes: Buffer.from(ab), contentType: data.type || 'application/octet-stream' }
}

// ── attachments (change-order) ────────────────────────────────────────
export const uploadAttachment = (opts: { path: string; bytes: Buffer; contentType: string }) =>
  uploadTo(ATTACHMENTS_BUCKET, opts)

export const createAttachmentSignedUrl = (path: string, ttlSeconds = 60) =>
  signedUrlFrom(ATTACHMENTS_BUCKET, path, ttlSeconds)

export const downloadAttachment = (path: string) => downloadFrom(ATTACHMENTS_BUCKET, path)

// ── budget files (Excel uploads behind each budget version) ───────────
export const uploadBudgetFile = (opts: { path: string; bytes: Buffer; contentType: string }) =>
  uploadTo(BUDGET_FILES_BUCKET, opts)

export const downloadBudgetFile = (path: string) => downloadFrom(BUDGET_FILES_BUCKET, path)

export const createBudgetFileSignedUrl = (path: string, ttlSeconds = 60) =>
  signedUrlFrom(BUDGET_FILES_BUCKET, path, ttlSeconds)
