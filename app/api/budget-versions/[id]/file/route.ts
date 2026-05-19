import { NextRequest, NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { BudgetVersion } from '@/types'
import fs from 'fs'
import path from 'path'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const versions = await readJson<BudgetVersion>('budget_versions.json')
  const version = versions.find((v) => v.id === params.id)

  if (!version) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  if (!version.file_name) return NextResponse.json({ error: 'Ingen fil lagret for denne versjonen' }, { status: 404 })

  const filePath = path.join(process.cwd(), 'data', 'uploads', version.file_name)
  if (!fs.existsSync(filePath)) return NextResponse.json({ error: 'Fil ikke funnet på disk' }, { status: 404 })

  const buffer = fs.readFileSync(filePath)
  const label = version.version === 0 ? 'Originalbudsjett' : `V${version.version}`
  const downloadName = `budsjett_${label}.xlsx`

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
    },
  })
}
