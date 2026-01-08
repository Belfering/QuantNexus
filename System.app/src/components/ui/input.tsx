import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onFocus, ...props }, ref) => {
    // Auto-select content on focus for number inputs
    const handleFocus = React.useCallback((e: React.FocusEvent<HTMLInputElement>) => {
      if (type === 'number') {
        e.target.select()
      }
      onFocus?.(e)
    }, [type, onFocus])

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-bold text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-border focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-45",
          className
        )}
        ref={ref}
        onFocus={handleFocus}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
