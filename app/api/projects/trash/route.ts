import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireUserAdmin } from '@/lib/api-guard'
import type { Project } from '@/types'

export async function GET() {
  // Trash is a destructive-recovery surface — restrict to main / company
  // only. PMs shouldn't be able to resurrect projects (or even browse
  // what's been thrown away across the company).
  const auth = await requireUserAdmin()
  if (!auth.ok) return auth.response

  const { data, error } = await getSupabaseAdmin()
    .from('projects')
    .select('*')
    .eq('deleted', true)
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  return NextResponse.json((data ?? []) as Project[])
}
