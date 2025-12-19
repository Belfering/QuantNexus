import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-slate-100 border border-slate-300 text-slate-900 hover:bg-slate-200 shadow-sm dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-600",
        destructive:
          "bg-red-50 border border-red-300 text-red-700 hover:bg-red-100 shadow-sm dark:bg-red-950 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900",
        outline:
          "border border-dashed border-slate-400 bg-white text-slate-900 hover:bg-slate-50 shadow-sm dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700",
        secondary:
          "bg-slate-200 border border-slate-300 text-slate-900 hover:bg-slate-300 shadow-sm dark:bg-slate-600 dark:border-slate-500 dark:text-slate-100 dark:hover:bg-slate-500",
        ghost:
          "border border-slate-300 hover:bg-slate-100 text-slate-900 dark:border-slate-600 dark:hover:bg-slate-800 dark:text-slate-100",
        link:
          "text-blue-600 underline-offset-4 hover:underline bg-transparent border-none p-0 dark:text-blue-400",
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
