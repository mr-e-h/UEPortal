/**
 * MinUE-merket — delt logo for sidebar-toppene og andre kompakte flater.
 *
 * Selve ikonet er en liten "node-tre"-figur (én fylt blå node på toppen, to
 * omrissnoder under) tegnet som inline-SVG slik at den er knivskarp i alle
 * størrelser og følger temaet (CSS-variablene). Ordmerket gjengir logoen sin
 * to-tonede stil: "Min" i mørk tekstfarge, "UE" i primærblått. Den fullstendige
 * raster-logoen (public/Logo.png) brukes der det er god plass, f.eks. login.
 */

export function LogoMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* forbindelseslinjer: ned fra toppnoden, ut til hver side, og ned til de to nodene */}
      <path
        d="M12 8V12M6 12H18M6 12V16M18 12V16"
        stroke="var(--color-primary)"
        strokeOpacity="0.45"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* toppnode (fylt) */}
      <rect x="9" y="2" width="6" height="6" rx="1.7" fill="var(--color-primary)" />
      {/* venstre node (blått omriss) */}
      <rect x="3" y="16" width="6" height="6" rx="1.7" stroke="var(--color-primary)" strokeWidth="1.7" />
      {/* høyre node (grått omriss) */}
      <rect x="15" y="16" width="6" height="6" rx="1.7" stroke="var(--color-border-strong)" strokeWidth="1.7" />
    </svg>
  )
}

interface LogoProps {
  /** Høyden på ikonet i px; ordmerket skaleres relativt til denne. */
  size?: number
  /** Legg på det lysere "Portal"-suffikset (brukes i sidebar-toppene). */
  showPortal?: boolean
  className?: string
}

export default function Logo({ size = 24, showPortal = false, className = '' }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      <span className="font-bold tracking-tight leading-none" style={{ fontSize: Math.round(size * 0.74) }}>
        <span style={{ color: 'var(--color-text-primary)' }}>Min</span>
        <span style={{ color: 'var(--color-primary)' }}>UE</span>
        {showPortal && (
          <span className="font-light ml-1.5" style={{ color: 'var(--color-text-secondary)' }}>
            Portal
          </span>
        )}
      </span>
    </span>
  )
}
