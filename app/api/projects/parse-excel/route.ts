import { NextRequest, NextResponse } from 'next/server'
import { parseExcelBuffer } from '@/lib/excel'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  try {
    const result = parseExcelBuffer(buffer)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Could not parse Excel file' }, { status: 422 })
  }
}
