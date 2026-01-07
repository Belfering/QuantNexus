// src/features/builder/components/IndicatorDropdown.tsx
// Hierarchical dropdown for selecting indicators with categories

import { useState, useEffect, useRef, useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { MetricChoice, CustomIndicator } from '../../../types'
import { INDICATOR_CATEGORIES, INDICATOR_INFO } from '../../../constants'
import { useBotStore } from '../../../stores'

// Tooltip component for indicator info
const IndicatorTooltip = ({ indicator }: { indicator: MetricChoice }) => {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const info = INDICATOR_INFO[indicator]

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ x: rect.right + 8, y: rect.top + rect.height / 2 })
    }
    setShow(true)
  }

  return (
    <div
      className="inline-flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShow(false)}
    >
      <span
        ref={triggerRef}
        className="w-3.5 h-3.5 rounded-full border border-muted-foreground/50 text-muted-foreground text-[9px] flex items-center justify-center cursor-help hover:border-foreground hover:text-foreground"
      >
        ?
      </span>
      {show && info && (
        <div
          className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-xl p-2.5 min-w-[240px] max-w-[300px]"
          style={{ left: pos.x, top: pos.y, transform: 'translateY(-50%)' }}
        >
          <div className="text-xs font-semibold mb-1.5 text-zinc-900 dark:text-zinc-100">{indicator}</div>
          <div className="text-[11px] text-zinc-600 dark:text-zinc-400 mb-2 leading-relaxed">{info.desc}</div>
          <div className="text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 rounded text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">
            {info.formula}
          </div>
        </div>
      )}
    </div>
  )
}

export interface IndicatorDropdownProps {
  value: MetricChoice
  onChange: (metric: MetricChoice) => void
  className?: string
  customIndicators?: CustomIndicator[] // Optional override - if not provided, fetches from store
}

export const IndicatorDropdown = ({ value, onChange, className, customIndicators: customIndicatorsProp }: IndicatorDropdownProps) => {
  const [open, setOpen] = useState(false)
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Get custom indicators from the active bot if not provided via props
  const { bots, activeBotId } = useBotStore()
  const activeBot = bots.find(b => b.id === activeBotId)
  const customIndicators = customIndicatorsProp ?? activeBot?.customIndicators ?? []

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

  // Build categories including custom indicators
  const allCategories = useMemo(() => {
    const cats: Record<string, MetricChoice[]> = {}

    // Add Custom category at the top if there are custom indicators
    if (customIndicators.length > 0) {
      cats['Custom Indicators'] = customIndicators.map(ci => `custom:${ci.id}` as MetricChoice)
    }

    // Add built-in categories
    for (const [cat, indicators] of Object.entries(INDICATOR_CATEGORIES)) {
      cats[cat] = indicators as MetricChoice[]
    }

    return cats
  }, [customIndicators])

  // Build custom indicator info lookup for display names
  const customIndicatorInfo = useMemo(() => {
    const lookup: Record<string, { name: string; formula: string }> = {}
    for (const ci of customIndicators) {
      lookup[`custom:${ci.id}`] = { name: ci.name, formula: ci.formula }
    }
    return lookup
  }, [customIndicators])

  // Find which category the current value belongs to
  const findCategoryForValue = (v: MetricChoice): string => {
    // Check custom indicators first
    if (v.startsWith('custom:') && customIndicators.length > 0) {
      return 'Custom Indicators'
    }
    for (const [cat, indicators] of Object.entries(INDICATOR_CATEGORIES)) {
      if (indicators.includes(v)) return cat
    }
    return 'Moving Averages'
  }

  // Get display name for an indicator
  const getDisplayName = (ind: MetricChoice): string => {
    if (ind.startsWith('custom:')) {
      const info = customIndicatorInfo[ind]
      return info ? info.name : ind
    }
    return ind
  }

  return (
    <div ref={dropdownRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        className="h-8 px-2 text-xs border border-border rounded bg-card text-left flex items-center gap-1 hover:bg-accent/50 min-w-[140px]"
        onClick={() => setOpen(!open)}
      >
        <span className="truncate flex-1">{getDisplayName(value)}</span>
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-[200] mt-1 bg-card border border-border rounded shadow-lg min-w-[160px] left-0">
          {Object.entries(allCategories).map(([category, indicators]) => (
            <div
              key={category}
              className="relative"
              onMouseEnter={() => setHoveredCategory(category)}
              onMouseLeave={() => setHoveredCategory(null)}
            >
              <div
                className={cn(
                  'px-3 py-1.5 text-xs cursor-pointer flex justify-between items-center',
                  hoveredCategory === category ? 'bg-accent' : 'hover:bg-accent/50',
                  findCategoryForValue(value) === category && 'font-medium',
                  category === 'Custom Indicators' && 'text-blue-600 dark:text-blue-400'
                )}
              >
                <span>{category}</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>

              {hoveredCategory === category && (
                <div className="absolute left-full top-0 z-[201] bg-card border border-border rounded shadow-lg min-w-[200px] max-h-[300px] overflow-y-auto">
                  {indicators.map((ind) => (
                    <div
                      key={ind}
                      className={cn(
                        'px-3 py-1.5 text-xs cursor-pointer flex items-center justify-between gap-2',
                        ind === value ? 'bg-accent font-medium' : 'hover:bg-accent/50'
                      )}
                      onClick={() => {
                        onChange(ind)
                        setOpen(false)
                      }}
                    >
                      <span className="truncate">{getDisplayName(ind)}</span>
                      {/* Show tooltip for built-in indicators, formula for custom */}
                      {ind.startsWith('custom:') ? (
                        <span className="text-muted-foreground font-mono text-[10px] max-w-[100px] truncate" title={customIndicatorInfo[ind]?.formula}>
                          {customIndicatorInfo[ind]?.formula}
                        </span>
                      ) : (
                        <IndicatorTooltip indicator={ind} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
