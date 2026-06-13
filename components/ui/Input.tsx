import { forwardRef, type InputHTMLAttributes } from 'react'

/**
 * Skjemafelt-modulen: kanonisk tekst-input. Samme klasser som har vært
 * copy-pastet i ~30 skjemaer — endre utseendet HER, så følger alle med.
 * Bruk gjerne sammen med <Field label="...">.
 */
export const inputCls =
  'w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-[var(--color-text-primary)] focus:outline-none focus:border-primary disabled:opacity-50'

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...props }, ref) {
    return <input ref={ref} className={`${inputCls} ${className}`} {...props} />
  },
)

export default Input
