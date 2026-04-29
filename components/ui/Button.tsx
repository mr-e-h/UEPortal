import { ButtonHTMLAttributes } from 'react'
import Link from 'next/link'

type Variant = 'primary' | 'secondary' | 'ghost'

const cls: Record<Variant, string> = {
  primary: 'bg-[#E30613] hover:bg-[#C20510] text-white',
  secondary: 'bg-muted hover:bg-gray-200 text-[var(--color-text-primary)]',
  ghost: 'hover:bg-muted text-[var(--color-text-secondary)]',
}

const base = 'inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50'

export default function Button({
  children,
  variant = 'primary',
  className = '',
  href,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; href?: string }) {
  const classes = `${base} ${cls[variant]} ${className}`
  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    )
  }
  return (
    <button className={classes} {...props}>
      {children}
    </button>
  )
}
