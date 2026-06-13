import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { inputCls } from './Input'

/**
 * Skjemafelt-modulen: kanonisk textarea. Deler stil med Input — én kilde.
 */
const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = '', ...props }, ref) {
    return <textarea ref={ref} className={`${inputCls} ${className}`} {...props} />
  },
)

export default Textarea
