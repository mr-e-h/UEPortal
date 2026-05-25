import { NextRequest, NextResponse } from 'next/server'
import { readJson } from '@/lib/data'
import { getSession } from '@/lib/auth'
import { isAdmin } from '@/lib/api-guard'
import type { Project, ProjectSubcontractor, ProjectBudgetLine, Product, User } from '@/types'

interface ProjectManagerLink {
  project_id: string
  user_id: string
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const requestedSubId = new URL(request.url).searchParams.get('subcontractor_id')
  if (!requestedSubId) return NextResponse.json({ error: 'subcontractor_id required' }, { status: 400 })

  // Non-admin users can only access their own subcontractor data
  if (!isAdmin(session) && session.subcontractor_id !== requestedSubId) {
    return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })
  }

  const subcontractorId = requestedSubId

  const [links, projects, allBudgetLines, allProducts, pmLinks, allUsers] = await Promise.all([
    readJson<ProjectSubcontractor>('project_subcontractors.json'),
    readJson<Project>('projects.json'),
    readJson<ProjectBudgetLine>('project_budget_lines.json'),
    readJson<Product>('products.json'),
    readJson<ProjectManagerLink>('project_managers.json'),
    readJson<User>('users.json'),
  ])

  const projectIds = links.filter((l) => l.subcontractor_id === subcontractorId).map((l) => l.project_id)
  const projectIdSet = new Set(projectIds)

  // Map each project to its assigned PMs so the sub can see who to contact.
  // Exclude password and other internal fields — return only public-safe ones.
  const usersById = new Map(allUsers.map((u) => [u.id, u]))
  const pmsByProject = new Map<string, Array<Pick<User, 'id' | 'full_name' | 'email'>>>()
  for (const link of pmLinks) {
    if (!projectIdSet.has(link.project_id)) continue
    const user = usersById.get(link.user_id)
    if (!user || user.active === false) continue
    const arr = pmsByProject.get(link.project_id) ?? []
    arr.push({ id: user.id, full_name: user.full_name, email: user.email })
    pmsByProject.set(link.project_id, arr)
  }

  const result = projects
    .filter((p) => projectIds.includes(p.id) && !p.deleted)
    .map((project) => {
      const assignedLines = allBudgetLines.filter(
        (bl) =>
          bl.project_id === project.id &&
          bl.assigned_subcontractor_id === subcontractorId &&
          (bl.line_type === 'subcontractor_work' || bl.line_type == null)
      )
      const linesWithProduct = assignedLines.map((bl) => {
        const product = allProducts.find((p) => p.id === bl.product_id)
        return {
          id: bl.id,
          product_id: bl.product_id,
          product_name: product?.name ?? '',
          product_description: product?.description ?? '',
          unit: product?.unit ?? '',
          budget_quantity: bl.budget_quantity,
          subcontractor_cost_price_snapshot: bl.subcontractor_cost_price_snapshot,
        }
      })
      return {
        ...project,
        budget_lines: linesWithProduct,
        project_managers: pmsByProject.get(project.id) ?? [],
      }
    })

  return NextResponse.json(result)
}
