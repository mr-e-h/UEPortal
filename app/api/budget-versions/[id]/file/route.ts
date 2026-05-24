import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/api-guard'
import { createBudgetFileSignedUrl, downloadBudgetFile } from '@/lib/storage'
import type { BudgetVersion } from '@/types'

/**
 * Download a stored budget Excel file.
 *
 * Two response modes:
 *   default     → proxies the bytes (Content-Disposition: attachment)
 *   ?redirect=1 → 302 to a fresh signed Storage URL, for `<a href>` use
 *
 * Legacy file_name values from the pre-Storage era looked like
 * `<uuid>_<filename>` (single segment, lived on local FS). New ones look
 * like `<project_id>/<uuid>_<filename>` (object key inside the
 * `budget-files` bucket). We disambiguate by checking for a slash.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { data: version, error } = await getSupabaseAdmin()
    .from('budget_versions')
    .select('id, version, file_name')
    .eq('id', params.id)
    .maybeSingle<Pick<BudgetVersion, 'id' | 'version' | 'file_name'>>()
  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  if (!version) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  if (!version.file_name) {
    return NextResponse.json({ error: 'Ingen fil lagret for denne versjonen' }, { status: 404 })
  }

  // Legacy (no slash) = filename only, never stored in Supabase Storage.
  // Can't serve those — FS is read-only on Vercel and the original dev-mode
  // uploads were never migrated.
  if (!version.file_name.includes('/')) {
    return NextResponse.json(
      { error: 'Filen ble lastet opp før Storage-migrering og er ikke lenger tilgjengelig' },
      { status: 410 },
    )
  }

  const wantRedirect = new URL(request.url).searchParams.get('redirect') === '1'

  if (wantRedirect) {
    try {
      const signed = await createBudgetFileSignedUrl(version.file_name, 60)
      return NextResponse.redirect(signed, 302)
    } catch (err) {
      console.error('budget file signed url:', err)
      return NextResponse.json({ error: 'Kunne ikke generere lenke' }, { status: 500 })
    }
  }

  // Default: proxy bytes so the browser gets a sensible filename.
  try {
    const { bytes, contentType } = await downloadBudgetFile(version.file_name)
    const label = version.version === 0 ? 'Originalbudsjett' : `V${version.version}`
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="budsjett_${label}.xlsx"`,
      },
    })
  } catch (err) {
    console.error('budget file download:', err)
    return NextResponse.json({ error: 'Kunne ikke laste ned fil' }, { status: 500 })
  }
}
