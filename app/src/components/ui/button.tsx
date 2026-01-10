import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-surface-2 border border-border text-text hover:bg-surface shadow-sm",
        destructive:
          "bg-surface border border-danger text-danger hover:bg-accent-bg shadow-sm",
        outline:
          "border border-dashed border-muted bg-surface text-text hover:bg-surface-2 shadow-sm",
        secondary:
          "bg-surface-2 border border-border text-text hover:bg-surface shadow-sm",
        ghost:
          "border border-border bg-transparent hover:bg-surface-2 text-text",
        link:
          "text-accent-text underline-offset-4 hover:underline bg-transparent border-none p-0",
        accent:
          "btn-accent shadow-sm",
      },
      size: {
        default: "h-9 px-3 py-2",
        sm: "h-8 px-2.5 py-1.5 text-xs",
        lg: "h-10 px-4 py-2.5",
        icon: "h-9 w-9 p-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
