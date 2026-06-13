import { forwardRef, type SelectHTMLAttributes } from 'react'
import { inputCls } from './Input'

/**
 * Skjemafelt-modulen: kanonisk select. Deler stil med Input — én kilde.
 * Bruk gjerne sammen med <Field label="...">.
 */
const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', children, ...props }, ref) {
    return (
      <select ref={ref} className={`${inputCls} ${className}`} {...props}>
        {children}
      </select>
    )
  },
)

export default Select
