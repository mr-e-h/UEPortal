import { NextRequest, NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import type { WeeklyReport, WeeklyReportLine, ProjectBudgetLine, Product } from '@/types'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const reports = readJson<WeeklyReport>('weekly_reports.json')
  const report = reports.find((r) => r.id === params.id)
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const allLines = readJson<WeeklyReportLine>('weekly_report_lines.json')
  const reportLines = allLines.filter((l) => l.weekly_report_id === params.id)

  const allBudgetLines = readJson<ProjectBudgetLine>('project_budget_lines.json')
  const allProducts = readJson<Product>('products.json')

  const enrichedLines = reportLines.map((line) => {
    const bl = allBudgetLines.find((b) => b.id === line.project_budget_line_id)
    const product = allProducts.find((p) => p.id === bl?.product_id)
    return {
      ...line,
      product_name: product?.name ?? '–',
      product_description: product?.description ?? '–',
      unit: product?.unit ?? '–',
      customer_price_snapshot: bl?.customer_price_snapshot ?? 0,
      subcontractor_cost_price_snapshot: bl?.subcontractor_cost_price_snapshot ?? 0,
    }
  })

  return NextResponse.json({ ...report, lines: enrichedLines })
}
