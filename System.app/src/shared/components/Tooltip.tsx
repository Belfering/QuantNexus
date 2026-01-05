import { useState, useRef, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  className?: string
}

/**
 * A simple tooltip component that shows on hover.
 */
export function Tooltip({
  content,
  children,
  position = 'top',
  delay = 200,
  className,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updatePosition = () => {
    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const scrollX = window.scrollX
    const scrollY = window.scrollY

    let x = rect.left + scrollX + rect.width / 2
    let y = rect.top + scrollY

    switch (position) {
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
              'fixed z-[100] px-2 py-1 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded shadow-lg pointer-events-none',
              'animate-in fade-in-0 zoom-in-95 duration-100',
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
