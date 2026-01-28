import { useState, useRef, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right' | 'auto'
  delay?: number
  className?: string
}

/**
 * A simple tooltip component that shows on hover.
 * Automatically positions to the left/right based on screen position to prevent cutoff.
 */
export function Tooltip({
  content,
  children,
  position = 'auto',
  delay = 200,
  className,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const [computedPosition, setComputedPosition] = useState<'left' | 'right'>('right')
  const triggerRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updatePosition = () => {
    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    const screenWidth = window.innerWidth

    let x = rect.left + scrollX + rect.width / 2
    let y = rect.top + scrollY

    // Auto position: if cursor is on right half of screen, show tooltip on left side
    // Otherwise show on right side to prevent cutoff
    let actualPosition = position
    if (position === 'auto') {
      const cursorX = rect.left + rect.width / 2
      actualPosition = cursorX > screenWidth / 2 ? 'left' : 'right'
      setComputedPosition(actualPosition)
    }

    switch (actualPosition) {
      case 'top':
        y = rect.top + scrollY - 8
        break
      case 'bottom':
        y = rect.bottom + scrollY + 8
        break
      case 'left':
        x = rect.left + scrollX - 8
        y = rect.top + scrollY + rect.height / 2
        break
      case 'right':
        x = rect.right + scrollX + 8
        y = rect.top + scrollY + rect.height / 2
        break
    }

    setCoords({ x, y })
  }

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      updatePosition()
      setIsVisible(true)
    }, delay)
  }

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setIsVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const positionClasses = {
    top: '-translate-x-1/2 -translate-y-full',
    bottom: '-translate-x-1/2',
    left: '-translate-x-full -translate-y-1/2',
    right: '-translate-y-1/2',
    auto: position === 'auto' && computedPosition === 'left' ? '-translate-x-full -translate-y-1/2' : '-translate-y-1/2',
  }

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-block"
      >
        {children}
      </div>
      {isVisible &&
        createPortal(
          <div
            className={cn(
              'fixed z-[100] px-3 py-2 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded shadow-lg pointer-events-none',
              'animate-in fade-in-0 zoom-in-95 duration-100',
              'max-w-xs whitespace-normal break-words',
              positionClasses[position],
              className
            )}
            style={{
              left: coords.x,
              top: coords.y,
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  )
}
