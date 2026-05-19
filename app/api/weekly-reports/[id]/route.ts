import { NextRequest, NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import type { WeeklyReport, WeeklyReportLine, ProjectBudgetLine, Product } from '@/types'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const reports = readJson<WeeklyReport>('weekly_reports.json')
  const report = reports.find((r) => r.id === params.id)
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userIsSub = isSub(session)
  if (userIsSub && report.subcontractor_id !== session.subcontractor_id) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }
  if (!userIsSub && !isAdmin(session)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const allLines = readJson<WeeklyReportLine>('weekly_report_lines.json')
  const reportLines = allLines.filter((l) => l.weekly_report_id === params.id)

  const allBudgetLines = readJson<ProjectBudgetLine>('project_budget_lines.json')
  const allProducts = readJson<Product>('products.json')

  const enrichedLines = reportLines.map((line) => {
    const bl = allBudgetLines.find((b) => b.id === line.project_budget_line_id)
    const product = allProducts.find((p) => p.id === bl?.product_id)
    const base = {
      ...line,
      product_name: product?.name ?? '–',
      product_description: product?.description ?? '–',
      unit: product?.unit ?? '–',
      subcontractor_cost_price_snapshot: bl?.subcontractor_cost_price_snapshot ?? 0,
    }
    if (userIsSub) return base
    return { ...base, customer_price_snapshot: bl?.customer_price_snapshot ?? 0 }
  })

  return NextResponse.json({ ...report, lines: enrichedLines })
}
