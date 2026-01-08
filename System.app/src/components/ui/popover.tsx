// src/components/ui/popover.tsx
// Simple popover component

import { useState, useRef, useEffect, ReactNode, createContext, useContext } from 'react'

interface PopoverProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

interface PopoverTriggerProps {
  asChild?: boolean
  children: ReactNode
}

interface PopoverContentProps {
  className?: string
  align?: 'start' | 'center' | 'end'
  children: ReactNode
}

interface PopoverContextType {
  isOpen: boolean
  handleOpenChange: (open: boolean) => void
}

const PopoverContext = createContext<PopoverContextType | null>(null)

export function Popover({ open, onOpenChange, children }: PopoverProps) {
  const [isOpen, setIsOpen] = useState(open || false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open)
    }
  }, [open])

  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen)
    onOpenChange?.(newOpen)
  }

  // Handle click outside to close
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        handleOpenChange(false)
      }
    }

    // Use mousedown instead of click to catch before other handlers
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <PopoverContext.Provider value={{ isOpen, handleOpenChange }}>
      <div ref={popoverRef} className="relative inline-block">
        {children}
      </div>
    </PopoverContext.Provider>
  )
}

export function PopoverTrigger({ asChild, children }: PopoverTriggerProps) {
  return <>{children}</>
}

export function PopoverContent({ className = '', align = 'start', children }: PopoverContentProps) {
  const context = useContext(PopoverContext)
  const alignClass = align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'

  if (!context?.isOpen) return null

  return (
    <div
      className={`absolute top-full mt-2 z-50 bg-background border border-border rounded-lg shadow-lg ${alignClass} ${className}`}
    >
      {children}
    </div>
  )
}
