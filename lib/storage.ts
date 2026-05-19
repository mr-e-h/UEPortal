import { getSupabaseAdmin } from './supabase'

/**
 * Private bucket for change-order attachments. Created via Supabase MCP
 * migration `create_attachments_bucket`. Objects are NOT publicly readable —
 * the server creates short-lived signed URLs (or proxies the bytes) so
 * downloads can be auth-gated.
 */
export const ATTACHMENTS_BUCKET = 'attachments'

export async function uploadAttachment(opts: {
  path: string
  bytes: Buffer
  contentType: string
}): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.storage.from(ATTACHMENTS_BUCKET).upload(opts.path, opts.bytes, {
    contentType: opts.contentType,
    upsert: true,
  })
  if (error) throw new Error(`storage upload failed: ${error.message}`)
}

export async function createAttachmentSignedUrl(path: string, ttlSeconds = 60): Promise<string> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, ttlSeconds)
  if (error || !data) throw new Error(`signed url failed: ${error?.message ?? 'unknown'}`)
  return data.signedUrl
}

export async function downloadAttachment(path: string): Promise<{ bytes: Buffer; contentType: string }> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb.storage.from(ATTACHMENTS_BUCKET).download(path)
  if (error || !data) throw new Error(`download failed: ${error?.message ?? 'unknown'}`)
  const ab = await data.arrayBuffer()
  return { bytes: Buffer.from(ab), contentType: data.type || 'application/octet-stream' }
}
