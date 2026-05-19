import { NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type { WeeklyReportLine } from '@/types'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  return NextResponse.json(readJson<WeeklyReportLine>('weekly_report_lines.json'))
}
