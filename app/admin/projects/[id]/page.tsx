/**
 * Admin project detail — React Server Component shell.
 *
 * Auth flow:
 *   1. Session guaranteed by the admin layout (redirects non-staff to /login).
 *   2. getEffectiveUser honours the super-admin "view-as" override.
 *   3. loadProjectDetail fetches all 17 data sources server-side in parallel
 *      (one function invocation), applying PM-scope + economy masking exactly
 *      as the API routes do. project === null → out of scope / missing → 404.
 *
 * The client island (ProjectDetailClient) is seeded with this data and renders
 * immediately — no blank-screen client-fetch waterfall on mount. fetchAll()
 * still runs client-side after mutations.
 */

import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getEffectiveUser } from '@/lib/view-as'
import { loadProjectDetail } from '@/lib/admin-project-detail'
import ProjectDetailClient from './ProjectDetailClient'

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const realUser = await getSession()
  if (!realUser) return null

  const user = await getEffectiveUser(realUser)
  const initialData = await loadProjectDetail(params.id, user)
  if (!initialData.project) notFound()

  return <ProjectDetailClient initialData={initialData} />
}
