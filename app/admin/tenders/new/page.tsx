import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { ADMIN_ROLES } from '@/lib/roles'
import { getProjectScope } from '@/lib/api-guard'
import type { Project, Product, Subcontractor } from '@/types'
import NewTenderForm from './NewTenderForm'

export const dynamic = 'force-dynamic'

export default async function NewTenderPage() {
  const me = await getSession()
  if (!me || !ADMIN_ROLES.includes(me.role)) redirect('/login')

  const sb = getSupabaseAdmin()
  const [projectsRes, productsRes, subsRes] = await Promise.all([
    sb.from('projects').select('id, name, project_number').neq('deleted', true),
    sb.from('products').select('id, name, description, unit').eq('active', true),
    sb.from('subcontractors').select('id, company_name, active').eq('active', true),
  ])

  let projects = (projectsRes.data ?? []) as Pick<Project, 'id' | 'name' | 'project_number'>[]
  // PM scope: a PM can only start a tender on their assigned projects.
  const scope = await getProjectScope(me)
  if (scope) projects = projects.filter((p) => scope.has(p.id))
  projects.sort((a, b) => a.name.localeCompare(b.name, 'nb'))

  const products = ((productsRes.data ?? []) as Pick<Product, 'id' | 'name' | 'description' | 'unit'>[])
    .sort((a, b) => (a.description || a.name).localeCompare(b.description || b.name, 'nb'))
  const subcontractors = ((subsRes.data ?? []) as Pick<Subcontractor, 'id' | 'company_name'>[])
    .sort((a, b) => a.company_name.localeCompare(b.company_name, 'nb'))

  return (
    <NewTenderForm
      projects={projects}
      products={products}
      subcontractors={subcontractors}
    />
  )
}
