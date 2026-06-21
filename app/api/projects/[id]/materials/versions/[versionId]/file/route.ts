import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ensureProjectWritable } from '@/lib/api-guard'
import { createBudgetFileSignedUrl, downloadBudgetFile } from '@/lib/storage'
import type { ProjectMaterialVersion } from '@/types'

/**
 * Download a stored material Excel file.
 *
 * Two response modes:
 *   default     → proxies the bytes (Content-Disposition: attachment)
 *   ?redirect=1 → 302 to a fresh signed Storage URL, for `<a href>` use
 *
 * Legacy file_name values that predate the budget-files storage path
 * (i.e. no slash in the name) cannot be served — the original FS uploads
 * were never migrated. We return 410 Gone in that case.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; versionId: string } },
) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { data: version, error } = await getSupabaseAdmin()
    .from('project_material_versions')
    .select('id, version, file_name, project_id')
    .eq('id', params.versionId)
    .maybeSingle<Pick<ProjectMaterialVersion, 'id' | 'version' | 'file_name' | 'project_id'>>()

  if (error) return NextResponse.json({ error: 'Henting feilet' }, { status: 500 })
  if (!version) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })

  // Verify the version belongs to the project in the URL (prevents ID enumeration)
  if (version.project_id !== params.id) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  }

  // PM scope: a project_manager may only download files for projects they are assigned to.
  const denied = await ensureProjectWritable(auth.user, version.project_id)
  if (denied) return denied

  if (!version.file_name) {
    return NextResponse.json({ error: 'Ingen fil lagret for denne versjonen' }, { status: 404 })
  }

  // Legacy (no slash) = filename only, never stored in Supabase Storage.
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
      console.error('material file signed url:', err)
      return NextResponse.json({ error: 'Kunne ikke generere lenke' }, { status: 500 })
    }
  }

  // Default: proxy bytes so the browser gets a sensible filename.
  try {
    const { bytes, contentType } = await downloadBudgetFile(version.file_name)
    const label = version.version === 0 ? 'Original' : `V${version.version}`
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="materiell_${label}.xlsx"`,
      },
    })
  } catch (err) {
    console.error('material file download:', err)
    return NextResponse.json({ error: 'Kunne ikke laste ned fil' }, { status: 500 })
  }
}
