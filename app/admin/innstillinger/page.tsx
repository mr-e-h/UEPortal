import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList, ChevronRight } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { USER_ADMIN_ROLES } from '@/lib/api-guard'
import Card from '@/components/ui/Card'

export const dynamic = 'force-dynamic'

/**
 * Innstillinger — samlingssted for oppsett og maler. Type prosjekt (og senere
 * fremdriftsplan-maler) bor her i stedet for som egne menypunkter, så
 * venstremenyen holdes til daglig arbeid. Kun main/company (USER_ADMIN_ROLES).
 */
const SETTINGS = [
  {
    href: '/admin/project-types',
    label: 'Type prosjekt',
    description: 'Kategorier av prosjekter med standard sjekklister og faser som genereres automatisk.',
    icon: ClipboardList,
  },
]

export default async function InnstillingerPage() {
  const me = await getSession()
  if (!me || !USER_ADMIN_ROLES.includes(me.role)) redirect('/login')

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Innstillinger</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">Oppsett og maler for hvordan portalen fungerer.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
        {SETTINGS.map((s) => {
          const Icon = s.icon
          return (
            <Link key={s.href} href={s.href} className="block">
              <Card className="p-5 hover:bg-muted transition-colors h-full">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary-soft text-primary flex-none">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{s.label}</h2>
                      <ChevronRight size={16} className="text-[var(--color-text-muted)] flex-none" />
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">{s.description}</p>
                  </div>
                </div>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
