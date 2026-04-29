import { NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import type { WeeklyReportLine } from '@/types'

export async function GET() {
  return NextResponse.json(readJson<WeeklyReportLine>('weekly_report_lines.json'))
}
