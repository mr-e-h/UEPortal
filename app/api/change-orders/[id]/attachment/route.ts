import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import { MAX_ATTACHMENT_BYTES, ALLOWED_ATTACHMENT_MIMES } from '@/lib/upload-config'
import type { ChangeOrder } from '@/types'
import fs from 'fs'
import path from 'path'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const orders = readJson<ChangeOrder>('change_orders.json')
  const idx = orders.findIndex((o) => o.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const order = orders[idx]
  if (isSub(session)) {
    if (order.subcontractor_id !== session.subcontractor_id) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }
  } else if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

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

  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const uploadFilename = `${params.id}-${sanitized}`
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

  fs.writeFileSync(path.join(uploadsDir, uploadFilename), buffer)

  const attachmentUrl = `/uploads/${uploadFilename}`
  orders[idx] = { ...orders[idx], attachment_url: attachmentUrl }
  writeJson('change_orders.json', orders)

  return NextResponse.json({ attachment_url: attachmentUrl })
}
