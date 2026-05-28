import { NextRequest, NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import { fmtProductLabel } from '@/lib/format'
import type { WeeklyReport, WeeklyReportLine, ProjectBudgetLine, Product } from '@/types'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const subcontractorId = searchParams.get('subcontractor_id')
  const year = searchParams.get('year')
  const week = searchParams.get('week')

  if (!projectId || !subcontractorId || !year || !week) {
    return NextResponse.json({ error: 'project_id, subcontractor_id, year, and week are required' }, { status: 400 })
  }

  if (!isAdmin(session)) {
    if (!isSub(session) || session.subcontractor_id !== subcontractorId) {
      return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
    }
  }

  const allReports = await readJson<WeeklyReport>('weekly_reports.json')
  const submissions = allReports.filter(
    (r) => r.project_id === projectId && r.subcontractor_id === subcontractorId &&
      r.year === Number(year) && r.week_number === Number(week)
  )

  const allLines = await readJson<WeeklyReportLine>('weekly_report_lines.json')
  const submissionIds = new Set(submissions.map((r) => r.id))
  const weekLines = allLines.filter((l) => submissionIds.has(l.weekly_report_id))

  const allBudgetLines = await readJson<ProjectBudgetLine>('project_budget_lines.json')
  const allProducts = await readJson<Product>('products.json')

  const byBudgetLine = new Map<string, {
    project_budget_line_id: string
    product_name: string
    product_code: string
    unit: string
    total_reported: number
    approved: number
    pending: number
    rejected: number
    approved_value: number
  }>()

  for (const line of weekLines) {
    const bl = allBudgetLines.find((b) => b.id === line.project_budget_line_id)
    const product = allProducts.find((p) => p.id === bl?.product_id)

    const existing = byBudgetLine.get(line.project_budget_line_id) ?? {
      project_budget_line_id: line.project_budget_line_id,
      product_name: fmtProductLabel(product),
      product_code: product?.id ?? '–',
      unit: product?.unit ?? '–',
      total_reported: 0,
      approved: 0,
      pending: 0,
      rejected: 0,
      approved_value: 0,
    }

    existing.total_reported += line.reported_quantity
    if (line.status === 'approved') {
      existing.approved += line.reported_quantity
      existing.approved_value += line.reported_quantity * (bl?.subcontractor_cost_price_snapshot ?? 0)
    } else if (line.status === 'pending') {
      existing.pending += line.reported_quantity
    } else if (line.status === 'rejected') {
      existing.rejected += line.reported_quantity
    }

    byBudgetLine.set(line.project_budget_line_id, existing)
  }

  return NextResponse.json({
    week: Number(week),
    year: Number(year),
    submissions,
    lines_summary: Array.from(byBudgetLine.values()),
  })
}
