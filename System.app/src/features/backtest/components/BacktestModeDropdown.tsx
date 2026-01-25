// src/features/backtest/components/BacktestModeDropdown.tsx
// Dropdown component for selecting backtest mode

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { BacktestMode } from '@/types'
import { BACKTEST_MODE_INFO } from '@/constants'

export type BacktestModeDropdownProps = {
  value: BacktestMode
  onChange: (mode: BacktestMode) => void
  className?: string
}

/**
 * Dropdown for selecting backtest mode with tooltips explaining each mode
 */
export function BacktestModeDropdown({
  value,
  onChange,
  className,
}: BacktestModeDropdownProps) {
  const [open, setOpen] = useState(false)
  const [hoveredMode, setHoveredMode] = useState<BacktestMode | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  // Clear hoveredMode when dropdown closes
  useEffect(() => {
    if (!open) {
      setHoveredMode(null)
    }
  }, [open])

  const modes: BacktestMode[] = ['CC', 'OO', 'OC', 'CO']

  return (
    <div ref={dropdownRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        className="flex items-center gap-1 text-xs bg-transparent border-0 p-0 cursor-pointer hover:text-accent"
        onClick={() => setOpen(!open)}
      >
        <span>{BACKTEST_MODE_INFO[value].label}</span>
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-md shadow-lg z-50 min-w-[130px]">
          {modes.map((mode) => (
            <div
              key={mode}
              className={cn(
                'px-3 py-1.5 text-xs cursor-pointer hover:bg-muted/50 flex items-center justify-between gap-2',
                mode === value && 'bg-muted/30 font-medium'
              )}
              onClick={() => {
                onChange(mode)
                setOpen(false)
              }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setTooltipPos({ x: rect.right + 8, y: rect.top + rect.height / 2 })
                setHoveredMode(mode)
              }}
              onMouseLeave={() => setHoveredMode(null)}
            >
              <span>{BACKTEST_MODE_INFO[mode].label}</span>
            </div>
          ))}
        </div>
      )}
      {hoveredMode && (
        <div
          className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-xl p-2.5 min-w-[240px] max-w-[300px] pointer-events-none"
          style={{ left: tooltipPos.x, top: tooltipPos.y, transform: 'translateY(-50%)' }}
        >
          <div className="text-xs font-semibold mb-1.5 text-zinc-900 dark:text-zinc-100">{BACKTEST_MODE_INFO[hoveredMode].label}</div>
          <div className="text-[11px] text-zinc-600 dark:text-zinc-400 mb-2 leading-relaxed">{BACKTEST_MODE_INFO[hoveredMode].desc}</div>
          <div className="text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 rounded text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">{BACKTEST_MODE_INFO[hoveredMode].formula}</div>
        </div>
      )}
    </div>
  )
}

export default BacktestModeDropdown
