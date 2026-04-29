export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin } from '@/lib/api-guard'
import type {
  Project,
  ProjectBudgetLine,
  WeeklyReport,
  WeeklyReportLine,
  ChangeOrder,
  Product,
} from '@/types'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const requestedSubId = searchParams.get('subcontractor_id')

  if (!requestedSubId) return NextResponse.json({ error: 'subcontractor_id required' }, { status: 400 })

  // Non-admin users can only access their own data
  if (!isAdmin(session) && session.subcontractor_id !== requestedSubId) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const projectId = searchParams.get('project_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const projects = readJson<Project>('projects.json')
  const budgetLines = readJson<ProjectBudgetLine>('project_budget_lines.json')
  const weeklyReports = readJson<WeeklyReport>('weekly_reports.json')
  const weeklyReportLines = readJson<WeeklyReportLine>('weekly_report_lines.json')
  const changeOrders = readJson<ChangeOrder>('change_orders.json')
  const products = readJson<Product>('products.json')

  const projectMap = new Map(projects.map((p) => [p.id, p]))
  const blMap = new Map(budgetLines.map((bl) => [bl.id, bl]))
  const productMap = new Map(products.map((p) => [p.id, p]))

  // Approved weekly reports for this UE
  let approvedReports = weeklyReports.filter(
    (r) => r.subcontractor_id === requestedSubId && (r.status === 'approved' || r.status === 'partially_approved')
  )
  if (projectId) approvedReports = approvedReports.filter((r) => r.project_id === projectId)

  const approvedReportIds = new Set(approvedReports.map((r) => r.id))
  let approvedLines = weeklyReportLines.filter(
    (l) => approvedReportIds.has(l.weekly_report_id) && l.status === 'approved'
  )

  if (from || to) {
    const reportDateMap = new Map(weeklyReports.map((r) => [r.id, r.submitted_at ?? r.created_at]))
    approvedLines = approvedLines.filter((l) => {
      const dateStr = reportDateMap.get(l.weekly_report_id)
      if (!dateStr) return false
      const d = dateStr.split('T')[0]
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
  }

  // Approved change orders for this UE
  let approvedCOs = changeOrders.filter(
    (co) => co.subcontractor_id === requestedSubId && co.status === 'approved'
  )
  if (projectId) approvedCOs = approvedCOs.filter((co) => co.project_id === projectId)
  if (from || to) {
    approvedCOs = approvedCOs.filter((co) => {
      const d = (co.reviewed_at ?? co.submitted_at ?? '').split('T')[0]
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
  }

  type LineItem = {
    report_line_id?: string
    change_order_id?: string
    project_id: string
    project_name: string
    product_name: string
    unit: string
    quantity: number
    cost_price: number
    cost_total: number
    date: string
    source: 'report' | 'change_order'
  }

  const lineItems: LineItem[] = []

  for (const line of approvedLines) {
    const bl = blMap.get(line.project_budget_line_id)
    if (!bl) continue
    const report = weeklyReports.find((r) => r.id === line.weekly_report_id)
    if (!report) continue
    const proj = projectMap.get(bl.project_id)
    if (!proj || proj.deleted) continue
    const product = productMap.get(bl.product_id)

    lineItems.push({
      report_line_id: line.id,
      project_id: bl.project_id,
      project_name: proj.name,
      product_name: product?.name ?? '–',
      unit: product?.unit ?? '–',
      quantity: line.reported_quantity,
      cost_price: bl.subcontractor_cost_price_snapshot,
      cost_total: line.reported_quantity * bl.subcontractor_cost_price_snapshot,
      date: (report.submitted_at ?? report.created_at).split('T')[0],
      source: 'report',
    })
  }

  for (const co of approvedCOs) {
    const proj = projectMap.get(co.project_id)
    if (!proj || proj.deleted) continue
    const product = productMap.get(co.product_id)

    lineItems.push({
      change_order_id: co.id,
      project_id: co.project_id,
      project_name: proj.name,
      product_name: product?.name ?? '–',
      unit: co.unit,
      quantity: co.requested_quantity,
      cost_price: co.cost_price_snapshot,
      cost_total: co.total_cost,
      date: (co.reviewed_at ?? co.submitted_at ?? '').split('T')[0],
      source: 'change_order',
    })
  }

  const totalCost = lineItems.reduce((s, l) => s + l.cost_total, 0)

  return NextResponse.json({
    lines: lineItems,
    summary: {
      line_count: lineItems.length,
      total_cost: totalCost,
    },
  })
}
