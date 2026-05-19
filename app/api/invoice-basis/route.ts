import { NextRequest, NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import type {
  Project,
  ProjectBudgetLine,
  WeeklyReport,
  WeeklyReportLine,
  ChangeOrder,
  Subcontractor,
  Product,
} from '@/types'

function fmt(n: number) {
  return n.toFixed(2)
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const subcontractorId = searchParams.get('subcontractor_id')
  const from = searchParams.get('from') // ISO date string
  const to = searchParams.get('to')     // ISO date string
  const type = (searchParams.get('type') ?? 'ue') as 'ue' | 'customer'
  const excludeBilled = searchParams.get('exclude_billed') !== 'false'

  const projects = await readJson<Project>('projects.json')
  const budgetLines = await readJson<ProjectBudgetLine>('project_budget_lines.json')
  const weeklyReports = await readJson<WeeklyReport>('weekly_reports.json')
  const weeklyReportLines = await readJson<WeeklyReportLine>('weekly_report_lines.json')
  const changeOrders = await readJson<ChangeOrder>('change_orders.json')
  const subcontractors = await readJson<Subcontractor>('subcontractors.json')
  const products = await readJson<Product>('products.json')

  const projectMap = new Map(projects.map((p) => [p.id, p]))
  const blMap = new Map(budgetLines.map((bl) => [bl.id, bl]))
  const subMap = new Map(subcontractors.map((s) => [s.id, s]))
  const productMap = new Map(products.map((p) => [p.id, p]))

  // Filter approved weekly report lines
  let approvedReports = weeklyReports.filter(
    (r) => r.status === 'approved' || r.status === 'partially_approved'
  )
  if (projectId) approvedReports = approvedReports.filter((r) => r.project_id === projectId)
  if (subcontractorId) approvedReports = approvedReports.filter((r) => r.subcontractor_id === subcontractorId)

  const approvedReportIds = new Set(approvedReports.map((r) => r.id))
  let approvedLines = weeklyReportLines.filter(
    (l) => approvedReportIds.has(l.weekly_report_id) && l.status === 'approved'
  )
  if (excludeBilled) approvedLines = approvedLines.filter((l) => !l.billed_at)

  // Filter by date range using report submitted_at
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

  // Filter approved change orders
  let approvedCOs = changeOrders.filter((co) => co.status === 'approved')
  if (projectId) approvedCOs = approvedCOs.filter((co) => co.project_id === projectId)
  if (subcontractorId) approvedCOs = approvedCOs.filter((co) => co.subcontractor_id === subcontractorId)
  if (excludeBilled) approvedCOs = approvedCOs.filter((co) => !co.reviewed_at) // use reviewed_at as proxy
  if (from || to) {
    approvedCOs = approvedCOs.filter((co) => {
      const d = (co.reviewed_at ?? co.submitted_at ?? '')?.split('T')[0]
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
  }

  // Build line items grouped by project+subcontractor
  type LineItem = {
    report_line_id?: string
    change_order_id?: string
    project_id: string
    project_name: string
    subcontractor_id: string | null
    subcontractor_name: string
    product_name: string
    unit: string
    quantity: number
    cost_price: number
    sales_price: number
    cost_total: number
    sales_total: number
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
    if (!proj) continue
    const sub = bl.assigned_subcontractor_id ? subMap.get(bl.assigned_subcontractor_id) : null
    const product = productMap.get(bl.product_id)

    lineItems.push({
      report_line_id: line.id,
      project_id: bl.project_id,
      project_name: proj.name,
      subcontractor_id: bl.assigned_subcontractor_id,
      subcontractor_name: sub?.company_name ?? '–',
      product_name: product?.name ?? '–',
      unit: product?.unit ?? '–',
      quantity: line.reported_quantity,
      cost_price: bl.subcontractor_cost_price_snapshot,
      sales_price: bl.customer_price_snapshot,
      cost_total: line.reported_quantity * bl.subcontractor_cost_price_snapshot,
      sales_total: line.reported_quantity * bl.customer_price_snapshot,
      date: (report.submitted_at ?? report.created_at).split('T')[0],
      source: 'report',
    })
  }

  for (const co of approvedCOs) {
    const proj = projectMap.get(co.project_id)
    if (!proj) continue
    const sub = subMap.get(co.subcontractor_id)
    const product = productMap.get(co.product_id)

    lineItems.push({
      change_order_id: co.id,
      project_id: co.project_id,
      project_name: proj.name,
      subcontractor_id: co.subcontractor_id,
      subcontractor_name: sub?.company_name ?? '–',
      product_name: product?.name ?? '–',
      unit: co.unit,
      quantity: co.requested_quantity,
      cost_price: co.cost_price_snapshot,
      sales_price: co.customer_price_snapshot,
      cost_total: co.total_cost,
      sales_total: co.total_customer_value,
      date: (co.reviewed_at ?? co.submitted_at ?? '').split('T')[0],
      source: 'change_order',
    })
  }

  const totalCost = lineItems.reduce((s, l) => s + l.cost_total, 0)
  const totalSales = lineItems.reduce((s, l) => s + l.sales_total, 0)

  return NextResponse.json({
    lines: lineItems,
    summary: {
      line_count: lineItems.length,
      total_cost: totalCost,
      total_sales_value: totalSales,
      profit: totalSales - totalCost,
      margin: totalSales > 0 ? ((totalSales - totalCost) / totalSales * 100).toFixed(1) : '0.0',
    },
  })
}
