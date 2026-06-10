import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { ADMIN_ROLES } from '@/lib/roles'

/**
 * Server-guard for Fakturagrunnlag. Selve siden er en klientkomponent (uten
 * egen server-redirect), og selv om alle data-API-ene bak den 403'er for
 * ikke-økonomiroller, skal byggeleder/andre ikke engang få det tomme skallet.
 * ADMIN_ROLES = main/company/project_manager (samme modell som totaløkonomi).
 */
export default async function InvoiceBasisLayout({ children }: { children: React.ReactNode }) {
  const me = await getSession()
  if (!me) redirect('/login')
  if (!ADMIN_ROLES.includes(me.role)) redirect('/admin')
  return <>{children}</>
}
