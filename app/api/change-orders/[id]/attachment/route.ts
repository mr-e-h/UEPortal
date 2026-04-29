import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import type { ChangeOrder } from '@/types'
import fs from 'fs'
import path from 'path'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { filename, data, mimeType } = await request.json() as {
    filename: string
    data: string
    mimeType: string
  }

  const orders = readJson<ChangeOrder>('change_orders.json')
  const idx = orders.findIndex((o) => o.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const uploadFilename = `${params.id}-${sanitized}`
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

  const base64Data = data.replace(/^data:[^;]+;base64,/, '')
  fs.writeFileSync(path.join(uploadsDir, uploadFilename), Buffer.from(base64Data, 'base64'))

  const attachmentUrl = `/uploads/${uploadFilename}`
  orders[idx] = { ...orders[idx], attachment_url: attachmentUrl }
  writeJson('change_orders.json', orders)

  return NextResponse.json({ attachment_url: attachmentUrl })
}
