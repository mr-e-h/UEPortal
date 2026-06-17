import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireUserAdmin } from '@/lib/api-guard'

/**
 * Angre/slette en registrert fakturering. KUN administrasjonsnivå (main /
 * company) — en prosjektleder kan REGISTRERE en fakturering, men ikke reversere
 * den, og byggeleder/UE har ingen tilgang i det hele tatt. requireUserAdmin er
 * samme strenge porten som brukeradministrasjon, og main/company har global
 * tilgang, så ingen ekstra prosjekt-scope-sjekk trengs.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const { error, count } = await getSupabaseAdmin()
    .from('project_invoices')
    .delete({ count: 'exact' })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: 'Angring feilet' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Fakturering ikke funnet' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
