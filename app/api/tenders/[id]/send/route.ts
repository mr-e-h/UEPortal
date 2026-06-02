import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import { logTenderActivity } from '@/lib/tender'
import type { Tender, TenderLine, TenderInvitation } from '@/types'

/**
 * POST /api/tenders/[id]/send — publish a draft tender so invited UEs can
 * price it. Requires a deadline, at least one line, and at least one invited
 * UE. Moves status draft → sent.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const sb = getSupabaseAdmin()
  const { data: tender } = await sb
    .from('tenders')
    .select('*')
    .eq('id', params.id)
    .maybeSingle<Tender>()
  if (!tender) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  const denied = await ensureProjectWritable(auth.user, tender.project_id)
  if (denied) return denied

  if (tender.status !== 'draft') {
    return NextResponse.json({ error: 'Kun kladd kan sendes' }, { status: 400 })
  }
  if (!tender.deadline_at) {
    return NextResponse.json({ error: 'Sett en svarfrist før du sender' }, { status: 400 })
  }

  const [{ data: lines }, { data: invites }] = await Promise.all([
    sb.from('tender_lines').select('id').eq('tender_id', params.id),
    sb.from('tender_invitations').select('id').eq('tender_id', params.id),
  ])
  if (((lines ?? []) as TenderLine[]).length === 0) {
    return NextResponse.json({ error: 'Legg til minst én linje før du sender' }, { status: 400 })
  }
  if (((invites ?? []) as TenderInvitation[]).length === 0) {
    return NextResponse.json({ error: 'Inviter minst én underentreprenør før du sender' }, { status: 400 })
  }

  const { data: updated, error } = await sb
    .from('tenders')
    .update({ status: 'sent', updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .maybeSingle<Tender>()
  if (error) return NextResponse.json({ error: 'Lagring feilet' }, { status: 500 })

  await logTenderActivity(params.id, 'sent', auth.user.full_name)
  return NextResponse.json(updated)
}
