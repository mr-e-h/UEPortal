import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { isAdmin, isSub } from '@/lib/api-guard'
import type { WeeklyReport, WeeklyReportLine, ProjectBudgetLine, Product } from '@/types'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const sb = getSupabaseAdmin()

  const { data: report, error: reportErr } = await sb
    .from('weekly_reports')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<WeeklyReport>()
  if (reportErr) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const userIsSub = isSub(session)
  if (userIsSub && report.subcontractor_id !== session.subcontractor_id) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }
  if (!userIsSub && !isAdmin(session)) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const { data: linesData } = await sb
    .from('weekly_report_lines')
    .select('*')
    .eq('weekly_report_id', params.id)
  const reportLines = (linesData ?? []) as WeeklyReportLine[]

  // Only fetch the budget lines + products we actually need to enrich the
  // returned rows — bounded by report scope.
  const blIds = Array.from(new Set(reportLines.map((l) => l.project_budget_line_id)))
  const { data: bls } = blIds.length > 0
    ? await sb.from('project_budget_lines').select('*').in('id', blIds)
    : { data: [] as ProjectBudgetLine[] }
  const budgetLines = (bls ?? []) as ProjectBudgetLine[]
  const productIds = Array.from(new Set(budgetLines.map((bl) => bl.product_id)))
  const { data: products } = productIds.length > 0
    ? await sb.from('products').select('id, name, description, unit').in('id', productIds)
    : { data: [] as Pick<Product, 'id' | 'name' | 'description' | 'unit'>[] }
  const productMap = new Map(
    ((products ?? []) as Pick<Product, 'id' | 'name' | 'description' | 'unit'>[])
      .map((p) => [p.id, p]),
  )
  const blMap = new Map(budgetLines.map((bl) => [bl.id, bl]))

  const enrichedLines = reportLines.map((line) => {
    const bl = blMap.get(line.project_budget_line_id)
    const product = bl ? productMap.get(bl.product_id) : undefined
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
