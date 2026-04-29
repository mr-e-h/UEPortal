'use client'

import { useState } from 'react'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string | number
  onChange: (raw: string) => void
}

function addSep(raw: string): string {
  if (raw === '' || raw === '-') return raw
  const neg = raw.startsWith('-')
  const abs = neg ? raw.slice(1) : raw
  const [int, dec] = abs.split('.')
  const formatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (neg ? '-' : '') + formatted + (dec !== undefined ? ',' + dec : '')
}

export default function NumberInput({ value, onChange, onFocus, onBlur, ...props }: Props) {
  const [focused, setFocused] = useState(false)
  const raw = String(value ?? '')

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={focused ? raw : addSep(raw)}
      onFocus={(e) => { setFocused(true); onFocus?.(e) }}
      onBlur={(e) => { setFocused(false); onBlur?.(e) }}
      onChange={(e) => {
        const clean = e.target.value.replace(/[\s ]/g, '').replace(',', '.')
        if (clean === '' || /^-?\d*\.?\d*$/.test(clean)) onChange(clean)
      }}
    />
  )
}
