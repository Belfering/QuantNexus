// src/features/builder/components/WeightPicker.tsx
// Dropdown picker for weight modes

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/shared/components/Tooltip'
import { TOOLTIP_CONTENT } from '@/config/tooltipContent'
import type { WeightMode } from '../../../types'

export const weightLabel = (mode: WeightMode): string => {
  switch (mode) {
    case 'equal':
      return 'Equal Weight'
    case 'defined':
      return 'Defined'
    case 'inverse':
      return 'Inverse Volatility'
    case 'pro':
      return 'Pro Volatility'
    case 'capped':
      return 'Capped'
  }
}

const WEIGHT_MODES: WeightMode[] = ['equal', 'defined', 'inverse', 'pro', 'capped']

export interface WeightPickerProps {
  value: WeightMode
  onChange: (mode: WeightMode) => void
  /** If true, keep dropdown open when selecting 'capped' (for additional config) */
  keepOpenOnCapped?: boolean
}

export const WeightPicker = ({ value, onChange, keepOpenOnCapped = true }: WeightPickerProps) => {
  const [isOpen, setIsOpen] = useState(false)

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const close = () => setIsOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [isOpen])

  // Get tooltip for current weight mode
  const getWeightModeTooltip = (mode: WeightMode): string => {
    switch (mode) {
      case 'equal':
        return TOOLTIP_CONTENT.model.weightModes.equal
      case 'defined':
        return "Custom weighting allows manual allocation percentages for each child branch. You set specific weight values for each child. For example, 60% to stocks and 40% to bonds. The total must sum to 100%."
      case 'inverse':
        return "Inverse volatility weighting allocates more to lower volatility assets. Assets with lower recent volatility get higher weights, creating a risk parity approach. For example, if stocks have 20% vol and bonds have 5% vol, bonds get 4x the allocation."
      case 'pro':
        return "Pro volatility weighting allocates more to higher volatility assets. This is the opposite of inverse vol - riskier assets get larger allocations. Useful for momentum or risk-seeking strategies."
      case 'capped':
        return TOOLTIP_CONTENT.model.weightModes.capped
    }
  }

  return (
    <div className="relative flex items-center gap-2">
      <Tooltip content="Weight mode determines how capital is allocated among child branches. Click to choose between equal weighting, volatility-based allocation, or custom percentages. The mode affects how the portfolio is constructed.">
        <Badge
          variant="default"
          className="cursor-pointer gap-1 py-1 px-2.5"
          onClick={(e) => {
            e.stopPropagation()
            setIsOpen((v) => !v)
          }}
        >
          {weightLabel(value)}
        </Badge>
      </Tooltip>
      {isOpen && (
        <div
          className="absolute top-full mt-1 left-0 flex flex-col bg-surface border border-border rounded-lg shadow-lg z-[200] min-w-[120px]"
          onClick={(e) => e.stopPropagation()}
        >
          {WEIGHT_MODES.map((w) => (
            <Tooltip key={w} content={getWeightModeTooltip(w)} position="right">
              <Button
                variant="ghost"
                className="justify-start rounded-none first:rounded-t-lg last:rounded-b-lg"
                onClick={() => {
                  onChange(w)
                  if (!keepOpenOnCapped || w !== 'capped') {
                    setIsOpen(false)
                  }
                }}
              >
                {weightLabel(w)}
              </Button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  )
}
