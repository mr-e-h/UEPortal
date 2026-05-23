import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import { MAX_ATTACHMENT_BYTES, ALLOWED_ATTACHMENT_MIMES } from '@/lib/upload-config'
import { uploadAttachment, createAttachmentSignedUrl } from '@/lib/storage'
import type { ChangeOrder } from '@/types'

async function loadOwnedOrder(id: string) {
  const session = await getSession()
  if (!session) return { error: NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 }) }

  const orders = await readJson<ChangeOrder>('change_orders.json')
  const idx = orders.findIndex((o) => o.id === id)
  if (idx === -1) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }

  const order = orders[idx]
  if (isSub(session)) {
    if (order.subcontractor_id !== session.subcontractor_id) {
      return { error: NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 }) }
    }
  } else if (!isAdmin(session)) {
    return { error: NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 }) }
  }
  return { session, orders, idx, order }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const owned = await loadOwnedOrder(params.id)
  if (owned.error) return owned.error
  const { orders, idx } = owned

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

  // Object key in Supabase Storage. Includes the EM id so we can authorize
  // GET by looking up the EM and checking ownership.
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectPath = `${params.id}/${sanitized}`

  try {
    await uploadAttachment({ path: objectPath, bytes: buffer, contentType: mimeType })
  } catch (err) {
    console.error('attachment upload:', err)
    return NextResponse.json({ error: 'Kunne ikke lagre vedlegg' }, { status: 500 })
  }

  // Store the object path in the DB, NOT a signed URL — URLs expire and we
  // need a stable reference. The GET endpoint below mints a fresh signed URL.
  orders[idx] = { ...orders[idx], attachment_url: objectPath }
  await writeJson('change_orders.json', orders)

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
