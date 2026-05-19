import { NextRequest, NextResponse } from 'next/server'
import { readJson, writeJson } from '@/lib/data'
import { requireAdmin } from '@/lib/api-guard'
import { randomUUID } from 'crypto'
import type { ChangeOrder, ProjectBudgetLine, ActivityEntry, ProjectSubcontractor } from '@/types'

function logActivity(
  entityId: string,
  action: ActivityEntry['action'],
  actor: string,
  comment?: string
) {
  const entries = readJson<ActivityEntry>('activity_log.json')
  entries.push({
    id: randomUUID(),
    entity_type: 'change_order',
    entity_id: entityId,
    action,
    actor,
    comment,
    created_at: new Date().toISOString(),
  })
  writeJson('activity_log.json', entries)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { status, admin_comment, reviewed_by } = await request.json() as {
    status: 'approved' | 'rejected' | 'pending'
    admin_comment?: string
    reviewed_by?: string
  }

  const orders = readJson<ChangeOrder>('change_orders.json')
  const idx = orders.findIndex((o) => o.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const order = orders[idx]
  const actor = reviewed_by ?? 'Admin'
  const now = new Date().toISOString()

  if (status === 'pending') {
    // Revert: undo a previous approval/rejection
    const prevStatus = order.status

    orders[idx] = {
      ...order,
      status: 'pending',
      admin_comment: null,
      reviewed_at: null,
      reviewed_by: null,
    }
    writeJson('change_orders.json', orders)

    // If it was approved, reverse the budget line effect
    if (prevStatus === 'approved') {
      const budgetLines = readJson<ProjectBudgetLine>('project_budget_lines.json')
      const existing = budgetLines.find(
        (bl) =>
          bl.project_id === order.project_id &&
          bl.product_id === order.product_id &&
          bl.assigned_subcontractor_id === order.subcontractor_id
      )
      if (existing) {
        const newQty = existing.budget_quantity - order.requested_quantity
        if (newQty <= 0) {
          // Remove the line if it was entirely from this change order
          writeJson('project_budget_lines.json', budgetLines.filter((bl) => bl.id !== existing.id))
        } else {
          const blIdx = budgetLines.findIndex((bl) => bl.id === existing.id)
          budgetLines[blIdx] = { ...existing, budget_quantity: newQty }
          writeJson('project_budget_lines.json', budgetLines)
        }
      }
    }

    logActivity(params.id, 'reverted', actor, admin_comment)
    return NextResponse.json(orders[idx])
  }

  orders[idx] = {
    ...order,
    status,
    admin_comment: admin_comment ?? null,
    reviewed_at: now,
    reviewed_by: actor,
  }
  writeJson('change_orders.json', orders)

  if (status === 'approved') {
    const budgetLines = readJson<ProjectBudgetLine>('project_budget_lines.json')
    const existing = budgetLines.find(
      (bl) =>
        bl.project_id === order.project_id &&
        bl.product_id === order.product_id &&
        bl.assigned_subcontractor_id === order.subcontractor_id
    )
    if (existing) {
      const blIdx = budgetLines.findIndex((bl) => bl.id === existing.id)
      budgetLines[blIdx] = {
        ...existing,
        budget_quantity: existing.budget_quantity + order.requested_quantity,
      }
    } else {
      const newLine: ProjectBudgetLine = {
        id: randomUUID(),
        project_id: order.project_id,
        product_id: order.product_id,
        budget_quantity: order.requested_quantity,
        customer_price_snapshot: order.customer_price_snapshot,
        assigned_subcontractor_id: order.subcontractor_id,
        subcontractor_cost_price_snapshot: order.cost_price_snapshot,
        source: 'change_order',
      }
      budgetLines.push(newLine)
    }
    writeJson('project_budget_lines.json', budgetLines)

    // Ensure UE has access to the project (defensive link creation)
    const links = readJson<ProjectSubcontractor>('project_subcontractors.json')
    const hasLink = links.some(
      (l) => l.project_id === order.project_id && l.subcontractor_id === order.subcontractor_id
    )
    if (!hasLink) {
      links.push({ id: randomUUID(), project_id: order.project_id, subcontractor_id: order.subcontractor_id })
      writeJson('project_subcontractors.json', links)
    }
  }

  logActivity(params.id, status === 'approved' ? 'approved' : 'rejected', actor, admin_comment)
  return NextResponse.json(orders[idx])
}
