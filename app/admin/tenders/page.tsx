import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { ADMIN_ROLES } from '@/lib/roles'
import { getProjectScope } from '@/lib/api-guard'
import { getDeletedProjectIds } from '@/lib/data'
import type { Tender, Project, TenderInvitation, TenderBid } from '@/types'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import TendersList from './TendersList'

export const dynamic = 'force-dynamic'

export default async function TendersPage() {
  const me = await getSession()
  if (!me || !ADMIN_ROLES.includes(me.role)) redirect('/login')

  const sb = getSupabaseAdmin()
  const [tendersRes, projectsRes, invitesRes, bidsRes] = await Promise.all([
    sb.from('tenders').select('*').order('created_at', { ascending: false }),
    sb.from('projects').select('id, name, project_number').neq('deleted', true),
    sb.from('tender_invitations').select('tender_id, status'),
    sb.from('tender_bids').select('tender_id, status, is_current'),
  ])

  let tenders = (tendersRes.data ?? []) as Tender[]
  const deleted = await getDeletedProjectIds()
  tenders = tenders.filter((t) => !deleted.has(t.project_id))

  // PM scope.
  const scope = await getProjectScope(me)
  if (scope) tenders = tenders.filter((t) => scope.has(t.project_id))

  const projects = (projectsRes.data ?? []) as Pick<Project, 'id' | 'name' | 'project_number'>[]
  const projMap = new Map(projects.map((p) => [p.id, p]))

  // Per-tender invited / answered counts for the list.
  const invites = (invitesRes.data ?? []) as Pick<TenderInvitation, 'tender_id' | 'status'>[]
  const bids = (bidsRes.data ?? []) as Pick<TenderBid, 'tender_id' | 'status' | 'is_current'>[]
  const invitedCount = new Map<string, number>()
  const answeredCount = new Map<string, number>()
  for (const inv of invites) {
    invitedCount.set(inv.tender_id, (invitedCount.get(inv.tender_id) ?? 0) + 1)
  }
  for (const b of bids) {
    if (b.is_current && b.status === 'submitted') {
      answeredCount.set(b.tender_id, (answeredCount.get(b.tender_id) ?? 0) + 1)
    }
  }

  const rows = tenders.map((t) => ({
    id: t.id,
    title: t.title || '(uten tittel)',
    status: t.status,
    deadline_at: t.deadline_at,
    project_name: projMap.get(t.project_id)?.name ?? '–',
    project_number: projMap.get(t.project_id)?.project_number ?? '',
    invited: invitedCount.get(t.id) ?? 0,
    answered: answeredCount.get(t.id) ?? 0,
  }))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Anbud / tilbudsforespørsler</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            Send prosjektgrunnlag til flere underentreprenører og sammenlign tilbud
          </p>
        </div>
        <Button href="/admin/tenders/new" variant="primary" className="px-3 py-1.5 text-xs">
          + Nytt anbud
        </Button>
      </div>

      <Card>
        {rows.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">Ingen anbud ennå.</p>
            <Link href="/admin/tenders/new" className="text-sm text-primary hover:underline mt-1 inline-block">
              Opprett det første anbudet →
            </Link>
          </div>
        ) : (
          <TendersList rows={rows} />
        )}
      </Card>
    </div>
  )
}
