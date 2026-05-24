import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import { MAX_ATTACHMENT_BYTES, ALLOWED_ATTACHMENT_MIMES } from '@/lib/upload-config'
import { uploadAttachment, createAttachmentSignedUrl } from '@/lib/storage'
import type { ChangeOrder } from '@/types'

async function loadOwnedOrder(id: string) {
  const session = await getSession()
  if (!session) return { error: NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 }) }

  const { data: order, error } = await getSupabaseAdmin()
    .from('change_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle<ChangeOrder>()
  if (error) return { error: NextResponse.json({ error: 'Henting feilet' }, { status: 500 }) }
  if (!order) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }

  if (isSub(session)) {
    if (order.subcontractor_id !== session.subcontractor_id) {
      return { error: NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 }) }
    }
  } else if (!isAdmin(session)) {
    return { error: NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 }) }
  }
  return { session, order }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const owned = await loadOwnedOrder(params.id)
  if (owned.error) return owned.error

  const { filename, data, mimeType } = await request.json() as {
    filename: string
    data: string
    mimeType: string
  }

  if (!ALLOWED_ATTACHMENT_MIMES.has(mimeType)) {
    return NextResponse.json({ error: 'Filtype ikke tillatt' }, { status: 415 })
  }

  const base64Data = data.replace(/^data:[^;]+;base64,/, '')
  const buffer = Buffer.from(base64Data, 'base64')
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: 'Fil for stor (maks 10 MB)' }, { status: 413 })
  }

  // Object key in Storage. EM id prefix authorizes GETs via ownership lookup.
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectPath = `${params.id}/${sanitized}`

  try {
    await uploadAttachment({ path: objectPath, bytes: buffer, contentType: mimeType })
  } catch (err) {
    console.error('attachment upload:', err)
    return NextResponse.json({ error: 'Kunne ikke lagre vedlegg' }, { status: 500 })
  }

  // Store the object path — URLs expire, paths don't. GET mints a signed URL.
  await getSupabaseAdmin()
    .from('change_orders')
    .update({ attachment_url: objectPath })
    .eq('id', params.id)

  return NextResponse.json({ attachment_url: objectPath })
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const owned = await loadOwnedOrder(params.id)
  if (owned.error) return owned.error
  const { order } = owned

  if (!order.attachment_url) {
    return NextResponse.json({ error: 'Ingen vedlegg' }, { status: 404 })
  }

  // Two response modes:
  //   default      → returns JSON { signed_url } (callers can fetch then use)
  //   ?redirect=1  → 302 to the signed URL (use as <img src> / <a href>)
  // The redirect form lets consumers treat this endpoint as a stable URL —
  // we mint a fresh short-lived signed URL per request, ownership re-checked.
  const wantRedirect = new URL(request.url).searchParams.get('redirect') === '1'

  // Legacy: existing rows have "/uploads/<id>-<filename>" public paths from
  // the pre-Storage era. These no longer exist on Vercel.
  if (order.attachment_url.startsWith('/uploads/')) {
    if (wantRedirect) {
      return NextResponse.json({ error: 'Vedlegget finnes ikke lenger' }, { status: 410 })
    }
    return NextResponse.json({ signed_url: order.attachment_url, legacy: true })
  }

  try {
    const signed = await createAttachmentSignedUrl(order.attachment_url, 60)
    if (wantRedirect) return NextResponse.redirect(signed, 302)
    return NextResponse.json({ signed_url: signed })
  } catch (err) {
    console.error('attachment signed url:', err)
    return NextResponse.json({ error: 'Kunne ikke generere lenke' }, { status: 500 })
  }
}
