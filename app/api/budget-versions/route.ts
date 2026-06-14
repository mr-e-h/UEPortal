import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth, isSub, getProjectScope, canSeeCustomerEconomics } from '@/lib/api-guard'
import type { BudgetVersion, ProjectSubcontractor } from '@/types'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const projectId = new URL(req.url).searchParams.get('project_id')
  const sb = getSupabaseAdmin()
  const query = sb.from('budget_versions').select('*').order('version', { ascending: true })
  if (projectId) query.eq('project_id', projectId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  let versions = (data ?? []) as BudgetVersion[]

  // UE: limit to linked projects AND strip MinUE's customer-side totals.
  if (isSub(auth.user)) {
    const subId = auth.user.subcontractor_id
    if (!subId) return NextResponse.json([])
    const { data: links } = await sb
      .from('project_subcontractors')
      .select('project_id')
      .eq('subcontractor_id', subId)
    const allowedProjectIds = new Set(
      ((links ?? []) as Pick<ProjectSubcontractor, 'project_id'>[]).map((l) => l.project_id),
    )
    // Strip BÅDE kundeside-salget OG den samlede UE-kosten: total_cost_value er
    // summen av ALLE UE-ers kost på prosjektet, så en UE kunne ellers utlede hva
    // konkurrentene koster. UE-en ser sin egen kost via /api/budget-lines.
    versions = versions
      .filter((v) => allowedProjectIds.has(v.project_id))
      .map((v) => ({ ...v, total_sales_value: 0, total_cost_value: 0 }))
    return NextResponse.json(versions)
  }

  // PM scope.
  const scope = await getProjectScope(auth.user)
  if (scope) versions = versions.filter((v) => scope.has(v.project_id))

  // Economy gate: byggeleder is scoped to their own projects but must NEVER
  // see MinUE's customer-side sales total. Only admin roles get it unmasked —
  // same masking the UE branch above applies.
  if (!canSeeCustomerEconomics(auth.user)) {
    versions = versions.map((v) => ({ ...v, total_sales_value: 0 }))
  }

  return NextResponse.json(versions)
}
